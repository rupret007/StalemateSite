// @vitest-environment node
// Real C2/C3 + engine behavior; identity, guardian and serial storage adapters
// are explicit local unit fixtures. Production HTTP/SQLite composition is separate.
import { describe, expect, it } from 'vitest';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';
import { createParticipationConsents, PARTICIPATION_LEDGER_KEY } from '../../hangout-worker/src/participation-consents.mjs';
import { createParticipationEnforcement } from '../../hangout-worker/src/participation-enforcement.mjs';
import { PARTICIPATION_PURPOSES } from '../../hangout-worker/src/participation-policy.mjs';

const START = 1800000000000, clone = value => structuredClone(value);
async function fixture({ staff = false } = {}) {
    let at = START, serial = 0, committed = new Map(), tail = Promise.resolve();
    const storage = {
        transaction(operation) {
            const work = tail.then(async () => {
                const staged = clone(committed);
                const result = await operation({ get: async key => clone(staged.get(key)), put: async (key, value) => staged.set(key, clone(value)) });
                committed = staged; return result;
            });
            tail = work.catch(() => {}); return work;
        }, snapshot: () => clone(committed)
    };
    const reference = () => `safety_reference_${String(++serial).padStart(8, '0')}`;
    const identities = new Map(), participants = new Map(), decisions = new Map(), guardians = new Map(), live = new Map();
    const config = { policy: { version: 1, policyVersion: 'synthetic-safety-v1', revision: 1, communityRef: 'synthetic_safety_community',
        noticeDigest: 'a'.repeat(64), decisionRef: 'synthetic_safety_operator', state: 'qualified', purposes: [...PARTICIPATION_PURPOSES],
        issuedAt: START, effectiveAt: START, expiresAt: START + 1000000, maxSessionMs: 10000 },
    rules: { version: 1, verifierRef: 'synthetic_safety_verifier', pendingMs: 10000, grantMs: 500000,
        subjectTailMs: 10000, guardianTailMs: 10000, receiptTailMs: 10000, callbackMs: 10000, operationMs: 10000 } };
    const ledger = createParticipationConsents({ storage, now: () => at, randomRef: reference, adapters: {
        qualifyPolicy: async () => ({ config: clone(config), expiresAt: START + 1000000 }),
        authenticateParticipant: async ({ proof, purpose }) => {
            const identity = participants.get(proof); if (!identity) return null;
            return purpose === 'begin' ? clone(identity) : { principalRef: identity.principalRef, communityRef: identity.communityRef, expiresAt: identity.expiresAt };
        }, verifyConsent: async ({ proof }) => clone(decisions.get(proof)), authenticateGuardian: async ({ proof }) => clone(guardians.get(proof))
    } });
    expect((await ledger.installPolicy('synthetic-policy')).ok).toBe(true);
    for (const id of ['alpha', 'bravo', 'third']) {
        const proof = reference(), principalRef = `synthetic_safety_${id}`;
        participants.set(proof, { operationRef: reference(), principalRef, communityRef: config.policy.communityRef, expiresAt: START + 500000 });
        const pending = await ledger.begin(proof, { expectedRevision: 0, purposes: [...PARTICIPATION_PURPOSES] }), decision = reference();
        decisions.set(decision, { operationRef: reference(), pendingRef: pending.pendingRef, subjectRef: pending.subjectRef, principalRef,
            guardianPrincipalRef: `synthetic_guardian_${id}`, decisionRef: reference(), verifierRef: config.rules.verifierRef,
            status: 'approved', purposes: [...PARTICIPATION_PURPOSES], verifiedAt: at, expiresAt: START + 500000 });
        expect((await ledger.complete(decision)).state).toBe('authorized');
        identities.set(id, { principalRef, communityRef: config.policy.communityRef, expiresAt: START + 500000 });
    }
    const frames = [], closed = [], controls = { fail: false };
    const participation = createParticipationEnforcement({ storage, now: () => at,
        resolveConnection: async connection => clone(identities.get(connection.id)),
        validateConnection: async ({ connection, identity }) => !!live.get(connection.id)
            && identity.principalRef === identities.get(connection.id)?.principalRef
            && ['dev', 'account', 'role', 'admin'].every(key => connection[key] === live.get(connection.id)[key]),
        // The production adapter reads partitioned rows. This unit fixture uses
        // the actual unpartitioned C2 ledger in the same serial transaction.
        readWithdrawn: async ({ tx, identities: selected }) => {
            const state = await tx.get(PARTICIPATION_LEDGER_KEY);
            return selected.map(identity => state.subjects.some(row => row.record.principalRef === identity.principalRef && row.record.state === 'withdrawn'));
        },
        writeEffects: async ({ tx, effects, costsOnly }) => {
            for (const [kind, value] of effects) await tx.put(`lobby:${kind}`, value);
            if (!costsOnly && controls.fail) throw Error('synthetic-effect-write-failure');
        }
    });
    const make = () => createLobby({ now: () => at, participation,
        send: (recipient, frame) => frames.push({ recipient, ...clone(frame) }), close: (...args) => closed.push(args),
        limits: { defaultSlow: 0, pmMinLobbyMs: 0 } });
    const engine = make(), message = async (id, frame, target = engine) => { at += 1000; return target.message(id, JSON.stringify(frame)); };
    const cmd = (id, name, args = [], ch = '#stalemate', target = engine) => message(id, { t: 'cmd', name, args, ch }, target);
    const namedCmd = (id, name, args = [], ch = '#stalemate', target = engine) => message(id, { t: 'cmd', name, args, ch,
        ...(name === 'msg' ? { pmExplicit: true } : { personNamed: true }) }, target);
    for (const id of ['alpha', 'bravo', 'third']) {
        const role = id === 'bravo' && staff ? 'owner' : 'fan', identity = { id, dev: `dev-${id}`, iph: `ip-${id}`, role, admin: role === 'owner', account: `account_${id}` };
        live.set(id, identity); expect((await engine.connect(identity)).ok).toBe(true);
        await message(id, { t: 'hello', nick: id[0].toUpperCase() + id.slice(1), age13: true });
    }
    async function withdraw(id = 'bravo', purposes = []) {
        const state = storage.snapshot().get(PARTICIPATION_LEDGER_KEY), subject = state.subjects.find(row => row.record.principalRef === identities.get(id).principalRef).record;
        const guardian = state.guardians.find(row => row.subjectRef === subject.subjectRef), proof = reference();
        guardians.set(proof, { operationRef: reference(), subjectRef: subject.subjectRef, principalRef: guardian.principalRef,
            guardianRef: guardian.guardianRef, guardianRevision: guardian.revision, expiresAt: at + 10000 });
        return ledger.change(proof, { expectedRevision: subject.revision, purposes: [...purposes] });
    }
    async function line(text = 'Benign selected message before sharing stops') {
        const before = frames.length; await message('alpha', { t: 'say', ch: '#stalemate', text });
        const sent = frames.slice(before).find(frame => frame.recipient === 'bravo' && frame.t === 'line'); expect(sent).toBeDefined(); return sent;
    }
    return { engine, participation, storage, controls, frames, closed, live, make, message, cmd, namedCmd, withdraw, line,
        advance: ms => { at += ms; } };
}

describe('withdrawn sharing keeps a bounded same-connection safety path', () => {
    it('removes public presence/media/contact while retaining the real witness for selected reporting and another guest remains active', async () => {
        const f = await fixture(), selected = await f.line();
        await f.cmd('alpha', 'join', ['#art-safety']); await f.cmd('bravo', 'join', ['#art-safety']); await f.cmd('third', 'join', ['#art-safety']);
        for (const id of ['alpha', 'bravo', 'third']) await f.message(id, { t: 'cam', ch: '#art-safety', on: true, adult18: true });
        await f.namedCmd('alpha', 'msg', ['Bravo', 'Benign accepted private safety message']); await f.namedCmd('bravo', 'accept', ['Alpha']);
        const privateLine = f.frames.find(frame => frame.recipient === 'bravo' && frame.t === 'pm'); expect(privateLine).toBeDefined();
        expect((await f.withdraw()).state).toBe('withdrawn'); const offset = f.frames.length;
        expect((await f.engine.refreshParticipation())?.ok).not.toBe(false);
        const retainedWitness = f.engine.sessionSnapshot().receipts.find(row => row.id === selected.id)?.recipients.includes('bravo') === true;
        await f.message('bravo', { t: 'report', id: selected.id, text: selected.text });
        await f.message('bravo', { t: 'report', id: privateLine.id, text: privateLine.text });
        const acknowledgedReports = f.frames.slice(offset).filter(frame => frame.recipient === 'bravo' && frame.t === 'report-status' && frame.submitted).length;
        console.info('Sharing safety transition', JSON.stringify({ closed: f.closed.map(([id, code]) => ({ id, code })), retainedWitness, acknowledgedReports }));
        expect(acknowledgedReports).toBe(2);
        expect(f.closed).toEqual([]);
        expect(f.frames.slice(offset).filter(frame => frame.recipient === 'bravo' && frame.t === 'sharing-stopped')).toHaveLength(1);
        expect(f.frames.slice(offset).filter(frame => frame.recipient === 'bravo' && ['part', 'join', 'line', 'admin', 'list', 'chan'].includes(frame.t))).toEqual([]);
        const safety = f.engine.sessionSnapshot().connections.find(row => row.id === 'bravo');
        expect(safety).toMatchObject({ safetyOnly: true, nick: '', channels: [], cams: [], pmOff: true, entrySource: '', away: '' });
        expect(f.engine.adminState().users.some(row => row.nick === 'Bravo')).toBe(false);
        expect(f.engine.sessionSnapshot().receipts.find(row => row.id === selected.id).recipients).toContain('bravo');
        expect(f.engine.adminState().reports.map(row => row.id)).toEqual(expect.arrayContaining([selected.id, privateLine.id]));
        expect(f.frames.filter(frame => frame.recipient === 'bravo' && frame.t === 'report-status' && frame.submitted)).toHaveLength(2);
        const chan = f.frames.filter(frame => frame.recipient === 'third' && frame.t === 'chan' && frame.ch.name === '#art-safety').at(-1).ch;
        expect(chan.names.map(row => row.nick)).toEqual(expect.arrayContaining(['Alpha', 'Third'])); expect(chan.names.some(row => row.nick === 'Bravo')).toBe(false);
        expect(chan.names.filter(row => row.cam)).toHaveLength(2);
        const after = f.frames.length; await f.message('third', { t: 'say', ch: '#stalemate', text: 'Benign third guest still speaking' });
        expect(f.frames.slice(after).filter(frame => frame.t === 'line').map(frame => frame.recipient).sort()).toEqual(['alpha', 'third']);
    });

    it('blocks every affirmative/privileged input and staff broadcasts without changing the separately granted role', async () => {
        const f = await fixture({ staff: true }); expect(f.engine.privateAdminReady('bravo')).toBe(true);
        await f.line(); expect((await f.withdraw()).state).toBe('withdrawn'); await f.engine.refreshParticipation();
        expect(f.engine.privateAdminReady('bravo')).toBe(false); expect(f.engine.privateAdminReady('missing')).toBe(false);
        const offset = f.frames.length, before = f.engine.roomSnapshot();
        for (const frame of [{ t: 'hello', nick: 'Restored', age13: true, safetyOnly: false }, { t: 'say', ch: '#stalemate', text: 'Must not publish' },
            { t: 'cmd', name: 'join', args: ['#art-denied'] }, { t: 'say', ch: '#stalemate', text: '/join #art-denied' },
            { t: 'cmd', name: 'shield', args: [] }, { t: 'admin-refresh' }, { t: 'entry-source', source: 'stalemate' },
            { t: 'cam', ch: '#stalemate', on: true, adult18: true }, { t: 'act', kind: 'rtc', ch: '#stalemate', to: 'third', sdp: { type: 'offer', sdp: 'v=0' } }]) await f.message('bravo', frame);
        f.engine.notifyAiStatus(); await Promise.resolve();
        expect(f.engine.roomSnapshot()).toEqual(before); expect(f.engine.snapshot().shield).toBe(false);
        expect(f.engine.sessionSnapshot().connections.find(row => row.id === 'bravo')).toMatchObject({ role: 'owner', admin: true, nick: '', safetyOnly: true });
        expect(f.frames.slice(offset).filter(frame => frame.recipient === 'bravo' && ['admin', 'line', 'join', 'chan', 'list', 'act', 'welcome'].includes(frame.t))).toEqual([]);
        expect(f.frames.slice(offset).filter(frame => frame.recipient !== 'bravo' && frame.t === 'line')).toEqual([]);
    });

    it('allows private block/ignore/help/quit cleanup, denies fabricated reports and retires the witness on actual disconnect', async () => {
        const f = await fixture(), selected = await f.line(); await f.withdraw(); await f.engine.refreshParticipation();
        await f.namedCmd('bravo', 'ignore', ['Alpha']); await f.namedCmd('bravo', 'block', ['Alpha']); await f.cmd('bravo', 'help');
        const own = f.engine.sessionSnapshot().connections.find(row => row.id === 'bravo');
        expect(own.ignores).toContain('alpha'); expect(own.blocks).toContain('dev-alpha');
        const before = f.engine.adminState().reports.length;
        await f.message('bravo', { t: 'report', id: selected.id, text: 'Fabricated replacement' });
        // A live selected public line is authoritative; a fabricated ID cannot select anything.
        await f.message('bravo', { t: 'report', id: 'mnot-delivered', text: selected.text });
        expect(f.engine.adminState().reports.length).toBeLessThanOrEqual(before + 1);
        expect(f.engine.adminState().reports[0]).toMatchObject({ id: selected.id, text: selected.text });
        await f.cmd('bravo', 'quit'); expect(f.engine.sessionSnapshot().connections.some(row => row.id === 'bravo')).toBe(false);
        expect(f.engine.privateAdminReady('bravo')).toBe(false);
        expect(f.engine.sessionSnapshot().receipts.every(row => !row.recipients.includes('bravo'))).toBe(true);
    });

    it('restores only the same admitted safety socket and preserves selected receipt reporting without a nickname or rejoin', async () => {
        const f = await fixture(), selected = await f.line(); await f.withdraw(); await f.engine.refreshParticipation();
        const saved = { net: f.engine.snapshot(), rooms: f.engine.roomSnapshot(), sessions: f.engine.sessionSnapshot() };
        const restored = f.make(); restored.restore(saved.net); await restored.restoreRooms(saved.rooms);
        expect(restored.restoreSessions(saved.sessions, [...f.live.values()]).resumed).toContain('bravo');
        const offset = f.frames.length; await f.message('bravo', { t: 'hello', nick: 'CannotResume', age13: true }, restored);
        expect(restored.sessionSnapshot().connections.find(row => row.id === 'bravo')).toMatchObject({ safetyOnly: true, nick: '', channels: [] });
        await f.message('bravo', { t: 'report', id: selected.id, text: selected.text }, restored);
        expect(restored.adminState().reports).toEqual([expect.objectContaining({ id: selected.id, text: selected.text })]);
        expect(f.frames.slice(offset).some(frame => frame.recipient === 'bravo' && ['welcome', 'join', 'line'].includes(frame.t))).toBe(false);
        const invalid = clone(saved.sessions); invalid.connections.find(row => row.id === 'bravo').channels = ['#stalemate'];
        const refused = f.make(); expect(refused.restoreSessions(invalid, [...f.live.values()]).resumed).toEqual([]);
    });

    it('keeps partial media reduction on the existing close path and never accepts a browser safetyOnly claim', async () => {
        const f = await fixture(); await f.cmd('bravo', 'join', ['#art-partial']);
        await f.message('bravo', { t: 'cam', ch: '#art-partial', on: true, adult18: true });
        expect((await f.withdraw('bravo', PARTICIPATION_PURPOSES.filter(purpose => purpose !== 'camera'))).state).toBe('authorized');
        await f.engine.refreshParticipation(); expect(f.closed.some(([id, code]) => id === 'bravo' && code === 4401)).toBe(true);
        expect(f.frames.some(frame => frame.recipient === 'bravo' && frame.t === 'sharing-stopped')).toBe(false);
        await f.message('third', { t: 'say', ch: '#stalemate', text: 'Benign forged mode field', safetyOnly: true });
        expect(f.engine.sessionSnapshot().connections.find(row => row.id === 'third')).not.toHaveProperty('safetyOnly');
    });
});
