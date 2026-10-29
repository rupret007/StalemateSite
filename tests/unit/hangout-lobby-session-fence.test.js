// @vitest-environment node
// Actual lobby engine with an explicit spy fence. This does not qualify a
// production session issuer, guardian consent or the fence's storage adapter.
import { describe, expect, it, vi } from 'vitest';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';
import { createParticipationEnforcement } from '../../hangout-worker/src/participation-enforcement.mjs';

const START = 1800000000000, clone = value => structuredClone(value);
function fixture({ participation, effectCommit: supplied } = {}) {
    let at = START;
    const frames = [], operations = [], commits = [], written = [], controls = { deny: false, held: null };
    const fence = supplied === undefined ? {
        prepare: vi.fn(operation => { const context = { operation: clone(operation) }; operations.push(context.operation); return context; }),
        commit: vi.fn(async (context, effects, options) => {
            commits.push({ context, effects: clone(effects), options });
            if (controls.held) { const held = controls.held; controls.held = null; await held; }
            if (controls.deny) return { ok: false, reason: 'session-denied' };
            if (options.participation) return options.participation.adapter.commit(options.participation.context, effects, { costsOnly: options.costsOnly });
            written.push(...clone(effects)); return { ok: true };
        })
    } : supplied;
    const persist = vi.fn(), close = vi.fn(), engine = createLobby({ now: () => at, effectCommit: fence, ...(participation ? { participation } : {}),
        send: (id, frame) => frames.push({ recipient: id, ...clone(frame) }), persist, close, limits: { defaultSlow: 0, pmMinLobbyMs: 0 } });
    const identity = (id, extra = {}) => ({ id, dev: `dev-${id}`, iph: `ip-${id}`, account: '', role: 'fan', admin: false,
        expiresAt: at + 60000, betaSid: `synthetic-beta-${id}`, betaInviteVersion: 'v1', authorityRef: `authority-${id}`, authorityRevision: 1, ...extra });
    const message = (id, frame) => engine.message(id, JSON.stringify(frame));
    const connect = async (id, nick, extra) => {
        const result = await engine.connect(identity(id, extra));
        if (result?.ok && nick) await message(id, { t: 'hello', nick, age13: true });
        return result;
    };
    const reset = () => { frames.length = operations.length = commits.length = written.length = 0; persist.mockClear(); };
    return { engine, fence, frames, operations, commits, written, controls, persist, close, identity, connect, message, reset, advance: ms => { at += ms; } };
}

describe('independent lobby effect commit fence', () => {
    it('prepares and commits the actual incoming connect candidate before publishing hello', async () => {
        const f = fixture(); let release;
        f.controls.held = new Promise(resolve => { release = resolve; });
        const candidate = f.identity('alice', { role: 'moderator', admin: true, account: 'verified-account' });
        const pending = f.engine.connect(candidate);
        await vi.waitFor(() => expect(f.commits).toHaveLength(1));
        expect(f.operations).toEqual([{ kind: 'connect', actorId: 'alice', connections: [Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== 'email'))] }]);
        expect(f.frames).toEqual([]); expect(f.persist).not.toHaveBeenCalled();
        release(); expect(await pending).toEqual({ ok: true });
        expect(f.frames.some(frame => frame.t === 'hello')).toBe(true);
    });

    it('refuses connect without legacy writes, hello or a retained connection when its fence denies', async () => {
        const f = fixture(); f.controls.deny = true;
        expect((await f.connect('alice')).ok).toBe(false);
        expect(f.engine._debug.conns.has('alice')).toBe(false);
        expect(f.frames.some(frame => frame.t === 'hello')).toBe(false);
        expect(f.written).toEqual([]); expect(f.persist).not.toHaveBeenCalled();
    });

    it.each([{}, { prepare() {} }, { commit() {} }])('fails closed for a configured incomplete fence %j', async effectCommit => {
        const f = fixture({ effectCommit });
        expect((await f.connect('alice')).ok).toBe(false);
        expect(f.engine._debug.conns.has('alice')).toBe(false);
        expect(f.frames.some(frame => frame.t === 'hello')).toBe(false);
        expect(f.persist).not.toHaveBeenCalled();
    });

    it.each(['prepare', 'commit'])('handles a throwing %s fence without admitting or falling back to legacy storage', async phase => {
        const effectCommit = { prepare: vi.fn(() => ({})), commit: vi.fn(async () => ({ ok: true })) };
        effectCommit[phase].mockImplementation(() => { throw Error('synthetic authority failure'); });
        const f = fixture({ effectCommit });
        await expect(f.connect('alice')).resolves.toMatchObject({ ok: false, reason: 'participation-unavailable' });
        expect(f.engine._debug.conns.has('alice')).toBe(false);
        expect(f.frames.some(frame => frame.t === 'hello')).toBe(false); expect(f.persist).not.toHaveBeenCalled();
    });

    it('checks actual staff refresh and moderation commands with no purpose adapter or fake grants', async () => {
        const f = fixture(); await f.connect('staff', 'Reviewer', { role: 'moderator', admin: true }); await f.connect('alice', 'Alice'); f.reset();
        await f.message('staff', { t: 'admin-refresh' });
        expect(f.operations.at(-1)).toMatchObject({ kind: 'message', actorId: 'staff' });
        expect(f.commits.at(-1).options.participation).toBeNull();
        expect(f.frames.some(frame => frame.t === 'admin' && frame.recipient === 'staff')).toBe(true);
        f.reset(); f.controls.deny = true;
        expect((await f.message('staff', { t: 'admin-refresh' })).ok).toBe(false);
        expect(f.frames.some(frame => frame.t === 'admin')).toBe(false);
        f.reset();
        expect((await f.message('staff', { t: 'cmd', ch: '#stalemate', name: 'mute', args: ['Alice', '10m'] })).ok).toBe(false);
        expect(f.engine.snapshot().mutes).toEqual({}); expect(f.written).toEqual([]);
        expect(f.frames.some(frame => frame.text?.startsWith("You're muted"))).toBe(false);
        expect(f.persist).not.toHaveBeenCalled();
    });

    it('holds report evidence and acknowledgments behind the independent session fence', async () => {
        const f = fixture(); await f.connect('alice', 'Alice'); await f.connect('bravo', 'Bravo');
        await f.message('bravo', { t: 'say', ch: '#stalemate', text: 'Synthetic report selection' });
        const line = f.frames.find(frame => frame.recipient === 'alice' && frame.t === 'line'); expect(line).toBeDefined();
        f.reset(); f.controls.deny = true;
        expect((await f.message('alice', { t: 'report', id: line.id })).ok).toBe(false);
        expect(f.operations[0]).toMatchObject({ kind: 'message', actorId: 'alice' });
        expect(f.commits[0].effects.some(([kind]) => kind === 'moderation-queue')).toBe(true);
        expect(f.commits.every(commit => commit.options.participation === null)).toBe(true);
        expect(f.engine.adminState().reports).toEqual([]); expect(f.written).toEqual([]);
        expect(f.frames.some(frame => frame.t === 'report-status' && frame.submitted)).toBe(false);
    });

    it('keeps joined public text actor-only and never publishes text after fence denial', async () => {
        const f = fixture(); await f.connect('alice', 'Alice'); await f.connect('bravo', 'Bravo'); f.reset(); f.controls.deny = true;
        expect((await f.message('alice', { t: 'say', ch: '#stalemate', text: 'Must remain unpublished' })).ok).toBe(false);
        expect(f.operations).toHaveLength(1); expect(f.operations[0].connections.map(row => row.id)).toEqual(['alice']);
        expect(f.frames.some(frame => frame.t === 'line' && frame.text === 'Must remain unpublished')).toBe(false);
        expect(f.engine._debug.lines.size).toBe(0); expect(f.written).toEqual([]);
        expect(f.commits[1].options.costsOnly).toBe(true);
        expect(f.commits[1].context).toBe(f.commits[0].context);
        expect(f.commits[1].effects.map(([kind]) => kind).sort()).toEqual(['abuse', 'net', 'sessions']);
    });

    it('labels actual client control and completion and explicit cleanup/system operations', async () => {
        const f = fixture(); await f.connect('staff', 'Reviewer', { role: 'moderator', admin: true }); f.reset();
        await f.engine.reserveTransportControl('staff');
        await f.engine.completePrivateReportAction('staff', { ok: true, status: 'dismissed', id: 'synthetic-report' });
        await f.engine.tick(); await f.engine.restoreRooms({ version: 1, rooms: [] });
        await f.engine.restoreModerationQueue({ reports: [], held: [] }); await f.engine.restoreAiReviews([]);
        await f.engine.applyAiReview('missing-review', { status: 'reviewed', flagged: false });
        await f.engine.refreshParticipation(); await f.engine.disconnect('staff');
        expect(f.operations.map(operation => [operation.kind, operation.actorId])).toEqual([
            ['control', 'staff'], ['private-report-complete', 'staff'], ['tick', ''], ['restore-rooms', ''],
            ['restore-moderation', ''], ['restore-ai', ''], ['apply-ai', ''], ['refresh', ''], ['disconnect', 'staff']
        ]);
        expect(f.operations.every(operation => Object.keys(operation).sort().join(',') === 'actorId,connections,kind')).toBe(true);
        expect(f.persist).not.toHaveBeenCalled();
    });

    it('retains only trusted live identity binding fields after a session restore', async () => {
        const first = fixture(); await first.connect('alice', 'Alice'); const saved = first.engine.sessionSnapshot();
        Object.assign(saved.connections[0], { expiresAt: START + 999999, betaSid: 'forged-sid', betaInviteVersion: 'forged-version', authorityRef: 'forged-authority', authorityRevision: 999 });
        const resumed = fixture(); const live = resumed.identity('alice', { expiresAt: START + 20000, betaSid: 'live-sid', betaInviteVersion: 'live-version', authorityRef: 'live-authority', authorityRevision: 2 });
        expect(resumed.engine.restoreSessions(saved, [live])).toEqual({ resumed: ['alice'], rejected: [] });
        await resumed.message('alice', { t: 'admin-refresh' });
        expect(resumed.operations[0].connections[0]).toEqual(Object.fromEntries(Object.entries(live).filter(([key]) => key !== 'email')));
        expect(JSON.stringify(resumed.engine.sessionSnapshot())).not.toContain('live-authority');
    });

    it('does not import an optional binding from saved metadata when the live identity omits it', async () => {
        const first = fixture(); await first.connect('alice', 'Alice'); const saved = first.engine.sessionSnapshot();
        Object.assign(saved.connections[0], { betaSid: 'forged-sid', authorityRef: 'forged-authority', authorityRevision: 999 });
        const resumed = fixture(); const live = { id: 'alice', dev: 'dev-alice', iph: 'ip-alice', account: '', role: 'fan', admin: false };
        expect(resumed.engine.restoreSessions(saved, [live]).resumed).toEqual(['alice']);
        await resumed.message('alice', { t: 'admin-refresh' });
        expect(resumed.operations[0].connections[0]).toEqual(live);
    });

    it('passes a real optional participation adapter/context through without replacing its decision', async () => {
        const purpose = { prepare: vi.fn(() => ({ purpose: true })), allows: vi.fn(() => false), commit: vi.fn(async () => ({ ok: true })),
            providerAllowed: vi.fn(), startProvider: vi.fn(), revisionFor: vi.fn() };
        const f = fixture({ participation: purpose }); await f.connect('alice');
        expect(f.commits[0].options.participation).toEqual({ adapter: purpose, context: { purpose: true } });
        expect(purpose.commit).toHaveBeenCalledOnce();
        const result = await f.message('alice', { t: 'hello', nick: 'Alice', age13: true });
        expect(result.ok).toBe(false); expect(purpose.allows).toHaveBeenCalled();
        expect(f.frames.some(frame => frame.t === 'welcome')).toBe(false);
    });

    it('preserves synchronous legacy admission and ordinary persistence when no adapter is configured', async () => {
        const send = vi.fn(), persist = vi.fn(), engine = createLobby({ now: () => START, send, persist });
        expect(engine.connect({ id: 'legacy', dev: 'dev-legacy', iph: 'ip-legacy' })).toEqual({ ok: true });
        await engine.message('legacy', JSON.stringify({ t: 'hello', nick: 'Legacy', age13: true }));
        expect(send.mock.calls.some(([, frame]) => frame.t === 'welcome')).toBe(true); expect(persist).toHaveBeenCalled();
    });
});

describe('C3 commit transaction composition', () => {
    it('executes no-check effects using one supplied guarded transaction without nesting default storage', async () => {
        const initial = new Map(), state = { rows: initial }, defaultTransaction = vi.fn(async operation => operation({}));
        const readPrincipals = async () => ({ ok: false });
        const writeEffects = vi.fn(async ({ tx, effects }) => { for (const [key, value] of effects) await tx.put(key, value); });
        const c3 = createParticipationEnforcement({ storage: { transaction: defaultTransaction }, resolveConnection: async () => null,
            validateConnection: async () => false, readPrincipals, writeEffects });
        const context = await c3.prepare([]); defaultTransaction.mockClear();
        const phases = [], guarded = vi.fn(async operation => {
            const staged = clone(state.rows); const tx = { put: async (key, value) => staged.set(key, clone(value)) };
            phases.push('before'); const result = await operation(tx); phases.push('after'); state.rows = staged; return result;
        });
        expect(await c3.commit(context, [['net', { lock: 'readonly' }]], { transaction: guarded })).toEqual({ ok: true });
        expect(phases).toEqual(['before', 'after']); expect(guarded).toHaveBeenCalledOnce();
        expect(defaultTransaction).not.toHaveBeenCalled(); expect(state.rows.get('net')).toEqual({ lock: 'readonly' });
        const before = clone(state.rows);
        expect((await c3.commit(context, [['net', { lock: 'off' }]], { transaction: async operation => {
            const staged = clone(state.rows); await operation({ put: async (key, value) => staged.set(key, value) }); throw Error('session revoked at final fence');
        } })).ok).toBe(false);
        expect(state.rows).toEqual(before); expect(defaultTransaction).not.toHaveBeenCalled();
    });
});
