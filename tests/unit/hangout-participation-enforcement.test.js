// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';
import { createParticipationConsents, PARTICIPATION_LEDGER_KEY } from '../../hangout-worker/src/participation-consents.mjs';
import { PARTICIPATION_PURPOSES } from '../../hangout-worker/src/participation-policy.mjs';
import { createParticipationEnforcement } from '../../hangout-worker/src/participation-enforcement.mjs';
import { AI_CATEGORIES, createAiModerator } from '../../hangout-worker/src/ai-moderation.mjs';
import { createParticipationCheckpoint } from '../../hangout-worker/src/participation-checkpoint.mjs';
import { validRoom } from '../../hangout-worker/src/community-state.mjs';

const START = 1800000000000, clone = value => structuredClone(value);
function store() {
    let committed = new Map(), tail = Promise.resolve();
    const enqueue = operation => { const task = tail.then(operation); tail = task.catch(() => {}); return task; };
    return {
        transaction: operation => enqueue(async () => {
            const staged = clone(committed), result = await operation({ get: async key => clone(staged.get(key)), put: async (key, value) => staged.set(key, clone(value)) });
            committed = staged; return result;
        }),
        // Explicit non-retrying start fence: withdrawals share this same serial
        // ordering; release the fence immediately after the synchronous start,
        // without waiting for the external response or retrying the callback.
        dispatchStart: ({ validate, start }) => enqueue(async () => { await validate({ get: async key => clone(committed.get(key)) }); return { response: start() }; }).then(box => box.response),
        snapshot: () => clone(committed)
    };
}
function gate() {
    let enter, release; return { entered: new Promise(resolve => { enter = resolve; }), wait: () => { enter(); return new Promise(resolve => { release = resolve; }); }, release: () => release() };
}
async function setup({ purposes = PARTICIPATION_PURPOSES, peerPurposes = PARTICIPATION_PURPOSES, provider = false, maxFrames = 4000 } = {}) {
    let at = START, serial = 0;
    const reference = () => `synthetic_reference_${String(++serial).padStart(6, '0')}`, storage = store(), participants = new Map(), decisions = new Map(), guardians = new Map(), identities = new Map();
    const config = { policy: { version: 1, policyVersion: 'synthetic-policy-v1', revision: 1, communityRef: 'synthetic_shared_community',
        noticeDigest: 'a'.repeat(64), decisionRef: 'synthetic_operator_decision', state: 'qualified', purposes: [...PARTICIPATION_PURPOSES],
        issuedAt: START - 100, effectiveAt: START - 100, expiresAt: START + 1000000, maxSessionMs: 10000 },
    rules: { version: 1, verifierRef: 'synthetic_verified_adapter', pendingMs: 10000, grantMs: 500000,
        subjectTailMs: 10000, guardianTailMs: 10000, receiptTailMs: 10000, callbackMs: 10000, operationMs: 10000 } };
    const ledger = createParticipationConsents({ storage, now: () => at, randomRef: reference, adapters: {
        qualifyPolicy: async ({ proof }) => proof === 'synthetic_operator' ? { config: clone(config), expiresAt: at + 1000000 } : null,
        authenticateParticipant: async ({ proof, purpose }) => {
            const identity = participants.get(proof); if (!identity) return null;
            return purpose === 'begin' ? clone(identity) : { principalRef: identity.principalRef, communityRef: identity.communityRef, expiresAt: identity.expiresAt };
        }, verifyConsent: async ({ proof }) => clone(decisions.get(proof)), authenticateGuardian: async ({ proof }) => clone(guardians.get(proof))
    } });
    expect((await ledger.installPolicy('synthetic_operator')).ok).toBe(true);
    const enroll = async (name, allowed) => {
        const proof = reference(), principalRef = `synthetic_principal_${name}`;
        participants.set(proof, { operationRef: reference(), principalRef, communityRef: config.policy.communityRef, expiresAt: at + 500000 });
        const pending = await ledger.begin(proof, { expectedRevision: 0, purposes: [...allowed] }), decision = reference();
        decisions.set(decision, { operationRef: reference(), pendingRef: pending.pendingRef, subjectRef: pending.subjectRef, principalRef,
            guardianPrincipalRef: `synthetic_guardian_${name}`, decisionRef: reference(), verifierRef: config.rules.verifierRef,
            status: 'approved', purposes: [...allowed], verifiedAt: at, expiresAt: at + 500000 });
        expect((await ledger.complete(decision)).state).toBe('authorized');
        identities.set(name, { principalRef, communityRef: config.policy.communityRef, expiresAt: at + 500000 }); return { proof, principalRef };
    };
    const alice = await enroll('alice', purposes), bravo = await enroll('bravo', peerPurposes), sessionBindings = new Map(), controls = { commitGate: null, writeGate: null, failWrites: false, providerReady: provider, afterValidate: null, skipValidate: false };
    const validateConnection = async ({ connection, identity, at: time }) => {
        const current = identities.get(connection.id), session = sessionBindings.get(connection.id);
        return !!current && !!session && current.expiresAt > time && current.principalRef === identity.principalRef && current.communityRef === identity.communityRef
            && ['dev', 'account', 'role', 'admin'].every(key => session[key] === connection[key]);
    };
    const enforcement = createParticipationEnforcement({ storage, now: () => at, resolveConnection: async connection => clone(identities.get(connection.id)), validateConnection,
        providerQualified: () => controls.providerReady, dispatchStart: request => controls.skipValidate ? request.start() : storage.dispatchStart({
            validate: async tx => { await request.validate(tx); controls.afterValidate?.(); }, start: request.start }),
        beforeCommit: async ({ costsOnly }) => { if (!costsOnly && controls.commitGate) { const held = controls.commitGate; controls.commitGate = null; await held.wait(); } },
        writeEffects: async ({ tx, effects, costsOnly }) => {
            if (!costsOnly && controls.writeGate) { const held = controls.writeGate; controls.writeGate = null; await held.wait(); }
            if (!costsOnly && controls.failWrites) throw Error('synthetic write failure');
            for (const [kind, value] of effects) await tx.put(`lobby:${kind}`, value);
        } });
    const frames = [], closed = [], legacyPersist = vi.fn(), providerFetch = vi.fn(async () => new Response(JSON.stringify({ model: 'synthetic_model', results: [{ flagged: false,
        categories: Object.fromEntries(AI_CATEGORIES.map(key => [key, false])), category_scores: Object.fromEntries(AI_CATEGORIES.map(key => [key, 0])) }] }))), providerTasks = [];
    const providerControls = { quotaGate: null };
    const moderator = createAiModerator({ enabled: provider, apiKey: 'synthetic_only', now: () => at, fetchImpl: providerFetch,
        saveUsage: async () => { if (providerControls.quotaGate) { const held = providerControls.quotaGate; providerControls.quotaGate = null; await held.wait(); } } });
    let engine;
    const make = () => createLobby({ now: () => at, participation: enforcement, persist: legacyPersist,
        send: (id, frame) => frames.push({ recipient: id, ...clone(frame) }), close: (...args) => closed.push(args),
        limits: { defaultSlow: 0, pmMinLobbyMs: 0, framesPerConnection: maxFrames },
        reviewPublicText: provider ? request => { const task = moderator.review(request).then(result => engine.applyAiReview(request.id, result)); providerTasks.push(task); return task; } : null });
    engine = make();
    const connect = async (id, nick = id === 'alice' ? 'Alice' : 'Bravo', extra = {}) => {
        sessionBindings.set(id, { dev: `dev-${id}`, account: id === 'alice' ? 'a'.repeat(64) : 'b'.repeat(64), role: 'fan', admin: false, ...extra });
        const admission = await engine.connect({ id, dev: `dev-${id}`, iph: `ip-${id}`, account: id === 'alice' ? 'a'.repeat(64) : 'b'.repeat(64), ...extra });
        if (!admission?.ok) return admission;
        return engine.message(id, JSON.stringify({ t: 'hello', nick, age13: true, subjectRef: 'forged_subject_ref', consent: true }));
    };
    const message = (id, frame) => engine.message(id, JSON.stringify(frame));
    const cmd = (id, name, args = [], ch = '#stalemate') => message(id, { t: 'cmd', name, args, ch });
    const withdraw = async (name = 'alice', allowed = []) => {
        const state = storage.snapshot().get(PARTICIPATION_LEDGER_KEY), subject = state.subjects.find(item => item.record.principalRef === identities.get(name).principalRef).record;
        const guardian = state.guardians.find(item => item.subjectRef === subject.subjectRef), proof = reference();
        guardians.set(proof, { operationRef: reference(), subjectRef: subject.subjectRef, principalRef: guardian.principalRef, guardianRef: guardian.guardianRef, guardianRevision: guardian.revision, expiresAt: at + 10000 });
        return ledger.change(proof, { expectedRevision: subject.revision, purposes: [...allowed] });
    };
    return { storage, ledger, engine, enforcement, controls, frames, closed, identities, sessionBindings, validateConnection, config, alice, bravo, connect, message, cmd, withdraw, legacyPersist,
        providerFetch, providerControls, providerTasks, moderator, make, advance: ms => { at += ms; }, now: () => at,
        policyChange: async () => { config.policy = { ...config.policy, revision: 2, policyVersion: 'synthetic-policy-v2', noticeDigest: 'b'.repeat(64), decisionRef: 'synthetic_operator_change' }; return ledger.installPolicy('synthetic_operator'); } };
}

describe('controlled C3 engine integration', () => {
    it('uses verified C2 subjects in actual chat/room/artifact/registration actions without ordinary persist fallback', async () => {
        const f = await setup(); await f.connect('alice'); await f.connect('bravo');
        await f.message('alice', { t: 'say', ch: '#stalemate', text: 'Benign synthetic shared chat' });
        expect(f.frames.filter(frame => frame.t === 'line' && frame.text === 'Benign synthetic shared chat')).toHaveLength(2);
        await f.cmd('alice', 'join', ['#art-qualified']); await f.cmd('alice', 'register', [], '#art-qualified');
        await f.message('alice', { t: 'act', kind: 'stroke', ch: '#art-qualified', stroke: { id: 's1', color: '#009ee8', size: 8, pts: [[0.1, 0.2], [0.2, 0.3]] } });
        expect(f.engine.roomSnapshot().rooms[0].act.strokes).toHaveLength(1); expect(f.engine.roomSnapshot().rooms[0].owner).toBe('a'.repeat(64));
        expect(f.storage.snapshot().get('lobby:rooms').rooms[0].act.strokes).toHaveLength(1);
        expect(f.legacyPersist).not.toHaveBeenCalled();
    });
    it('does not let role, badge or forged client fields override missing purposes, while preserving existing room authority', async () => {
        const f = await setup({ purposes: ['public-artifact', 'public-disclosure'] }); await f.connect('alice', 'Alice', { role: 'owner', admin: true });
        expect((await f.message('alice', { t: 'say', ch: '#stalemate', text: 'Must not publish', consent: true })).ok).toBe(false);
        expect((await f.cmd('alice', 'join', ['#not-authorized'])).ok).toBe(false); expect(f.engine.roomSnapshot().rooms).toEqual([]);
        expect(f.frames.some(frame => frame.t === 'line' && frame.text === 'Must not publish')).toBe(false);
        const ordinary = await setup(); await ordinary.connect('alice'); await ordinary.connect('bravo'); await ordinary.cmd('alice', 'join', ['#art-host']); await ordinary.cmd('bravo', 'join', ['#art-host']);
        await ordinary.cmd('bravo', 'topic', ['Not the host'], '#art-host'); expect(ordinary.engine.roomSnapshot().rooms[0].topic).not.toBe('Not the host');
    });
    it.each(['withdrawal', 'policy'])('rechecks %s after queued work before committing any room/artifact/log or success frame', async change => {
        const f = await setup(); await f.connect('alice'); await f.connect('bravo'); f.frames.length = 0;
        const original = f.engine._debug.channels.get('#stalemate'), held = gate(); f.controls.commitGate = held;
        const pending = f.cmd('alice', 'join', ['#art-never-published']); await held.entered;
        if (change === 'withdrawal') expect((await f.withdraw()).state).toBe('withdrawn'); else expect((await f.policyChange()).ok).toBe(true);
        held.release(); expect((await pending).ok).toBe(false);
        expect(f.engine._debug.channels.get('#stalemate')).toBe(original); expect(f.engine.roomSnapshot().rooms).toEqual([]);
        expect(f.frames.some(frame => ['join', 'chan'].includes(frame.t) && frame.ch?.name === '#art-never-published')).toBe(false);
        expect(JSON.stringify([...f.storage.snapshot()])).not.toContain('#art-never-published');
        expect(f.engine._debug.conns.get('alice').frames).toBeGreaterThan(1); expect(f.engine.snapshot().budget.requests).toBeGreaterThan(0);
    });
    it('rolls back actual chat/receipts and preserves consumed allowances after withdrawal during persistence staging', async () => {
        const f = await setup(); await f.connect('alice'); await f.connect('bravo'); f.frames.length = 0;
        const before = f.engine._debug.conns.get('alice').frames, held = gate(); f.controls.commitGate = held;
        const pending = f.message('alice', { t: 'say', ch: '#stalemate', text: 'Unpublished synthetic body' }); await held.entered; await f.withdraw(); held.release();
        expect((await pending).ok).toBe(false); expect(f.frames.some(frame => frame.text === 'Unpublished synthetic body')).toBe(false);
        expect([...f.engine._debug.lines.values()].some(line => line.text === 'Unpublished synthetic body')).toBe(false);
        expect(JSON.stringify(f.engine.sessionSnapshot())).not.toContain('Unpublished synthetic body');
        expect(JSON.stringify(f.engine._debug.conns.get('alice'))).not.toContain('Unpublished synthetic body');
        expect(f.engine._debug.conns.get('alice').frames).toBe(before + 1); expect(f.engine._debug.conns.get('alice').tokens).toBeLessThan(5);
    });
    it('requires both peer states for actual direct contact and clears consented PM/camera grants after withdrawal', async () => {
        const f = await setup(); await f.connect('alice'); await f.connect('bravo');
        await f.cmd('alice', 'msg', ['Bravo', 'Synthetic first message']); await f.cmd('bravo', 'accept', ['Alice']);
        expect(f.frames.some(frame => frame.t === 'pm' && frame.text === 'Synthetic first message')).toBe(true);
        await f.cmd('alice', 'join', ['#art-camera']); await f.cmd('bravo', 'join', ['#art-camera']);
        await f.message('alice', { t: 'cam', ch: '#art-camera', on: true, adult18: true }); expect(f.engine._debug.conns.get('alice').cams.size).toBe(1);
        await f.withdraw('bravo'); f.frames.length = 0;
        expect((await f.cmd('alice', 'msg', ['Bravo', 'Must not reach a withdrawn peer'])).ok).toBe(false);
        await f.engine.refreshParticipation();
        expect(f.frames.some(frame => frame.t === 'pm')).toBe(false); expect(f.engine._debug.pm.size).toBe(0);
        await f.cmd('alice', 'block', ['Bravo']); await f.withdraw('alice'); await f.engine.refreshParticipation();
        expect(f.engine._debug.conns.has('alice')).toBe(false); expect(f.closed.some(row => row[0] === 'alice')).toBe(true);
    });
    it('does not grant a new device or restored session stale participation permission', async () => {
        const f = await setup(); await f.connect('alice'); await f.connect('bravo'); const saved = f.engine.sessionSnapshot(); await f.withdraw('alice');
        await f.engine.disconnect('alice'); await f.connect('new-device', 'Alice', { dev: 'dev-alice', account: 'a'.repeat(64) });
        expect(f.engine._debug.conns.get('new-device').nick).toBe('');
        expect((await f.message('new-device', { t: 'say', ch: '#stalemate', text: 'No stale device grant' }))?.ok).not.toBe(true);
        const resumed = f.make(); await resumed.restoreRooms(f.engine.roomSnapshot()); resumed.restoreSessions(saved, saved.connections.map(item => ({ ...item, email: '' })));
        expect((await resumed.message('alice', JSON.stringify({ t: 'say', ch: '#stalemate', text: 'No restored grant' }))).ok).toBe(false);
        expect(f.frames.some(frame => frame.t === 'line' && /No .*grant/.test(frame.text))).toBe(false);
    });
    it('rechecks session expiry after awaited writes and restores safety report state on failed commit', async () => {
        const f = await setup(); await f.connect('alice'); await f.connect('bravo'); await f.message('bravo', { t: 'say', ch: '#stalemate', text: 'Synthetic report target' });
        const line = f.frames.find(frame => frame.recipient === 'alice' && frame.t === 'line'), held = gate(); f.controls.writeGate = held;
        const publishing = f.message('alice', { t: 'say', ch: '#stalemate', text: 'Expired during write' }); await held.entered;
        f.identities.get('alice').expiresAt = f.now(); held.release(); expect((await publishing).ok).toBe(false);
        expect(f.frames.some(frame => frame.t === 'line' && frame.text === 'Expired during write')).toBe(false);
        const fresh = await setup(); await fresh.connect('alice'); await fresh.connect('bravo'); await fresh.message('bravo', { t: 'say', ch: '#stalemate', text: 'Another benign target' });
        const target = fresh.frames.find(frame => frame.recipient === 'alice' && frame.t === 'line'); fresh.controls.failWrites = true;
        const report = await fresh.message('alice', { t: 'report', id: target.id }); expect(report.ok).toBe(false);
        expect(fresh.engine.adminState().reports).toEqual([]); expect(fresh.frames.some(frame => frame.t === 'report-status' && frame.submitted)).toBe(false); expect(line).toBeDefined();
    });
    it('rejects a grouped mutation when bounded session metadata crosses 2 MiB, without committing its room or log', async () => {
        const f = await setup(); await f.connect('alice'); await f.connect('bravo');
        const saved = f.engine.sessionSnapshot(), original = clone(saved.connections[0]), padding = (prefix, n, length) => `${prefix}${String(n).padStart(length - prefix.length, 'x')}`;
        saved.connections = Array.from({ length: 150 }, (_, n) => ({ ...clone(original), id: n ? padding('socket', n, 128) : 'alice',
            dev: n ? padding('device', n, 128) : original.dev, iph: n ? padding('iphash', n, 128) : original.iph,
            account: n ? '' : original.account, nick: n ? `Guest${n}` : 'Alice', away: '',
            blocks: Array.from({ length: 50 }, (_, i) => padding('block', i, 128)), ignores: Array.from({ length: 50 }, (_, i) => padding('Ignore', i, 20)) }));
        const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength, target = 2 * 1024 * 1024 - 5;
        const receipt = (n, recipients) => ({ t: 'line', id: `mcapacity${n}`, ch: '#stalemate', from: 'Alice', to: '', prefix: '', band: false, moderator: false, me: false,
            ts: f.now(), authorDev: original.dev, digest: 'a'.repeat(64), recipients });
        saved.receipts = [];
        for (let n = 0; n < 1000; n++) {
            const row = receipt(n, saved.connections.map(c => c.id)); saved.receipts.push(row);
            if (bytes(saved) <= target && bytes(saved.receipts) <= 1024 * 1024) continue;
            saved.receipts.pop(); const last = receipt(n, ['alice']); saved.receipts.push(last);
            for (const c of saved.connections.slice(1)) { last.recipients.push(c.id); if (bytes(saved) > target || bytes(saved.receipts) > 1024 * 1024) { last.recipients.pop(); break; } }
            break;
        }
        for (const c of saved.connections.slice(1)) { const remaining = target - bytes(saved); if (remaining <= 0) break; c.away = 'x'.repeat(Math.min(80, remaining)); }
        expect(bytes(saved)).toBe(target); expect(bytes(saved.receipts)).toBeLessThanOrEqual(1024 * 1024);
        const resumed = f.make(), restored = resumed.restoreSessions(saved, saved.connections);
        expect(restored.rejected).toEqual([]); expect(restored.resumed).toHaveLength(150); expect(bytes(resumed.sessionSnapshot())).toBe(target);
        f.frames.length = 0;
        const result = await resumed.message('alice', JSON.stringify({ t: 'cmd', name: 'join', args: ['#art-session-cap'], ch: '#stalemate' }));
        expect(result).toMatchObject({ ok: false, reason: 'participation-capacity' }); expect(resumed.roomSnapshot().rooms).toEqual([]);
        expect(JSON.stringify([...f.storage.snapshot()])).not.toContain('#art-session-cap');
        expect(f.frames.some(frame => frame.t === 'join' && frame.ch.name === '#art-session-cap')).toBe(false);
        expect(bytes(resumed.sessionSnapshot())).toBeLessThanOrEqual(2 * 1024 * 1024); expect(f.legacyPersist).not.toHaveBeenCalled();
    });
    it('keeps reports/block/leave usable without affirmative participation after policy storage becomes unavailable', async () => {
        const f = await setup(); await f.connect('alice'); await f.connect('bravo'); await f.message('bravo', { t: 'say', ch: '#stalemate', text: 'Benign selected safety report' });
        const line = f.frames.find(frame => frame.recipient === 'alice' && frame.t === 'line');
        await f.storage.transaction(tx => tx.put(PARTICIPATION_LEDGER_KEY, { corrupt: true }));
        await f.message('alice', { t: 'report', id: line.id }); expect(f.engine.adminState().reports).toHaveLength(1);
        expect((await f.message('alice', { t: 'say', ch: '#stalemate', text: 'No policy fallback' })).ok).toBe(false);
        await f.cmd('alice', 'block', ['Bravo']); expect(f.engine._debug.conns.get('alice').blocks.has('dev-bravo')).toBe(true);
        await f.cmd('alice', 'quit'); expect(f.engine._debug.conns.has('alice')).toBe(false);
    });
    it('keeps safety actions usable when valid creative state exceeds the full checkpoint traversal ceiling', async () => {
        const f = await setup(); await f.connect('alice'); await f.connect('bravo');
        await f.message('bravo', { t: 'say', ch: '#stalemate', text: 'Benign safety pressure target' });
        const line = f.frames.find(frame => frame.recipient === 'alice' && frame.t === 'line');
        for (let room = 0; room < 2; room++) await f.cmd(room ? 'bravo' : 'alice', 'join', [`#art-pressure-${room}`]);
        for (const room of f.engine._debug.channels.values()) if (room.kind === 'art') room.act.strokes = Array.from({ length: 180 }, (_, n) => ({ id: `load-${n}`, color: '#009ee8', size: 8,
            pts: Array.from({ length: 80 }, (_, i) => [i / 100, (i + 1) / 100]) }));
        const rooms = f.engine.roomSnapshot().rooms;
        expect(rooms).toHaveLength(2); expect(rooms.every(room => validRoom(room, f.now()))).toBe(true);
        expect(JSON.stringify(rooms).length).toBeLessThan(8 * 1024 * 1024);
        expect(() => createParticipationCheckpoint({ channels: f.engine._debug.channels })).toThrow('limit exceeded');
        const before = f.engine._debug.conns.get('alice').frames;
        expect(await f.message('alice', { t: 'say', ch: '#stalemate', text: 'Cannot pay full capture cost' })).toMatchObject({ ok: false, reason: 'participation-capacity' });
        expect(f.engine._debug.conns.get('alice').frames).toBe(before + 1);
        await f.message('alice', { t: 'report', id: line.id }); expect(f.engine.adminState().reports).toHaveLength(1);
        await f.cmd('alice', 'block', ['Bravo']); expect(f.engine._debug.conns.get('alice').blocks.has('dev-bravo')).toBe(true);
        await f.cmd('alice', 'quit', ['Unqualified arbitrary quit text']); expect(f.engine._debug.conns.has('alice')).toBe(false);
        expect(f.frames.some(frame => frame.t === 'event' && frame.text.includes('Unqualified arbitrary quit text'))).toBe(false);
        expect(f.legacyPersist).not.toHaveBeenCalled();
    });
    it('queues bounded safety work behind an in-flight mutation and charges its frame before waiting', async () => {
        const f = await setup(); await f.connect('alice'); await f.connect('bravo'); await f.message('alice', { t: 'say', ch: '#stalemate', text: 'Benign queued report target' });
        const line = f.frames.find(frame => frame.recipient === 'bravo' && frame.t === 'line'), held = gate(); f.controls.commitGate = held;
        const first = f.cmd('alice', 'join', ['#art-queued']); await held.entered; const before = f.engine._debug.conns.get('bravo').frames; let finished = false;
        const report = f.message('bravo', { t: 'report', id: line.id }).then(value => { finished = true; return value; });
        await Promise.resolve(); expect(finished).toBe(false); expect(f.engine._debug.conns.get('bravo').frames).toBe(before + 1);
        held.release(); await first; await report; expect(f.engine.adminState().reports).toHaveLength(1);
    });
    it('quarantines a failed rollback without persisting semantic snapshots and settles every queued safety request', async () => {
        const f = await setup(); await f.connect('alice'); await f.connect('bravo'); await f.message('alice', { t: 'say', ch: '#stalemate', text: 'Benign earlier report target' });
        const target = f.frames.find(frame => frame.recipient === 'bravo' && frame.t === 'line'), held = gate(); f.controls.commitGate = held;
        const pending = f.message('alice', { t: 'say', ch: '#stalemate', text: 'Uncommitted quarantine body' }); await held.entered;
        const reporting = f.message('bravo', { t: 'report', id: target.id }), blocking = f.cmd('bravo', 'block', ['Alice']);
        Object.freeze(f.engine._debug.channels.get('#stalemate')); await f.withdraw(); held.release();
        for (const result of await Promise.all([pending, reporting, blocking])) expect(result).toMatchObject({ ok: false, reason: 'participation-unavailable' });
        expect(f.engine._debug.conns.size).toBe(0); expect(f.closed.filter(row => row[1] === 1011)).toHaveLength(2);
        expect(JSON.stringify([...f.storage.snapshot()])).not.toContain('Uncommitted quarantine body');
        expect(f.frames.some(frame => frame.t === 'report-status' && frame.submitted)).toBe(false);
    });
    it('gates badge disclosure but keeps source hiding available after withdrawal', async () => {
        const f = await setup(); await f.connect('alice'); await f.connect('bravo');
        await f.message('alice', { t: 'entry-source', source: 'stalemate' }); expect(f.engine._debug.conns.get('alice').entrySource).toBe('stalemate');
        await f.withdraw(); f.frames.length = 0;
        expect((await f.message('alice', { t: 'entry-source', source: 'rad-dad' })).ok).toBe(false);
        expect(f.engine._debug.conns.get('alice').entrySource).toBe('stalemate');
        await f.message('alice', { t: 'entry-source', source: '' }); expect(f.engine._debug.conns.get('alice').entrySource).toBe('');
        expect(f.frames.some(frame => frame.t === 'entry-source' && frame.source === '' && frame.accepted)).toBe(true);
    });
    it.each(['media-reception', 'external-provider'])('tears down a delivered watch session when only %s is withdrawn, preserving chat eligibility', async purpose => {
        const f = await setup({ provider: true }); await f.connect('alice'); await f.connect('bravo');
        await f.cmd('alice', 'join', ['#watch-teardown']); await f.cmd('bravo', 'join', ['#watch-teardown']);
        await f.message('alice', { t: 'act', kind: 'video', ch: '#watch-teardown', source: { kind: 'yt', id: 'dQw4w9WgXcQ' }, playing: false, pos: 0 });
        expect(f.frames.some(frame => frame.recipient === 'bravo' && frame.kind === 'video')).toBe(true);
        expect((await f.withdraw('bravo', PARTICIPATION_PURPOSES.filter(item => item !== purpose))).state).toBe('authorized');
        await f.engine.refreshParticipation(); expect(f.closed.some(row => row[0] === 'bravo' && row[1] === 4401)).toBe(true);
        expect(f.engine._debug.conns.has('bravo')).toBe(false); expect(f.engine._debug.conns.has('alice')).toBe(true);
        f.identities.set('bravo-return', clone(f.identities.get('bravo'))); await f.connect('bravo-return', 'Bravo', { account: 'b'.repeat(64) }); f.frames.length = 0;
        await f.cmd('bravo-return', 'join', ['#watch-teardown']); expect(f.frames.find(frame => frame.t === 'join' && frame.recipient === 'bravo-return').act.video).toBeNull();
        await f.message('bravo-return', { t: 'say', ch: '#stalemate', text: 'Chat still permitted after media withdrawal' });
        expect(f.frames.some(frame => frame.t === 'line' && frame.text === 'Chat still permitted after media withdrawal')).toBe(true);
    });
    it('checks camera/audio peers and filters watch snapshots/updates for unqualified recipients', async () => {
        const peerPurposes = PARTICIPATION_PURPOSES.filter(purpose => !['audio', 'media-reception', 'external-provider'].includes(purpose));
        const f = await setup({ peerPurposes, provider: true }); await f.connect('alice'); await f.connect('bravo');
        await f.cmd('alice', 'join', ['#art-media']); await f.cmd('bravo', 'join', ['#art-media']);
        await f.message('alice', { t: 'cam', ch: '#art-media', on: true, adult18: true }); f.frames.length = 0;
        expect((await f.message('alice', { t: 'act', kind: 'rtc', ch: '#art-media', to: 'bravo', sdp: { type: 'offer', sdp: 'v=0\r\nm=video 9 RTP/AVP 96\r\n' } })).ok).toBe(false);
        expect(f.frames.some(frame => frame.kind === 'rtc')).toBe(false);
        const watch = await setup({ peerPurposes, provider: true }); await watch.connect('alice'); await watch.connect('bravo');
        await watch.cmd('alice', 'join', ['#watch-qualified']); await watch.cmd('bravo', 'join', ['#watch-qualified']); watch.frames.length = 0;
        await watch.message('alice', { t: 'act', kind: 'video', ch: '#watch-qualified', source: { kind: 'yt', id: 'dQw4w9WgXcQ' }, playing: false, pos: 0 });
        expect(watch.frames.some(frame => frame.recipient === 'alice' && frame.kind === 'video')).toBe(true);
        expect(watch.frames.some(frame => frame.recipient === 'bravo' && frame.kind === 'video')).toBe(false);
        await watch.cmd('bravo', 'part', ['#watch-qualified']); watch.frames.length = 0; await watch.cmd('bravo', 'join', ['#watch-qualified']);
        expect(watch.frames.find(frame => frame.recipient === 'bravo' && frame.t === 'join').act.video).toBeNull();
    });
    it('rejects stale staff/account bindings even when the underlying participation principal is unchanged', async () => {
        const f = await setup(); await f.connect('alice', 'Alice', { role: 'owner', admin: true }); await f.connect('bravo');
        const held = gate(); f.controls.writeGate = held; const publishing = f.message('alice', { t: 'say', ch: '#stalemate', text: 'Stale staff exemption' }); await held.entered;
        f.sessionBindings.get('alice').role = 'fan'; f.sessionBindings.get('alice').admin = false; held.release();
        expect((await publishing).ok).toBe(false); expect(f.frames.some(frame => frame.t === 'line' && frame.text === 'Stale staff exemption')).toBe(false);
    });
    it('does not start an actual provider call when withdrawal commits while its quota reservation awaits', async () => {
        const f = await setup({ provider: true }); await f.connect('alice'); await f.connect('bravo'); const held = gate(); f.providerControls.quotaGate = held;
        await f.message('alice', { t: 'say', ch: '#stalemate', text: 'Benign provider guard fixture' }); await held.entered;
        expect(f.providerFetch).not.toHaveBeenCalled(); await f.withdraw(); held.release(); await Promise.all(f.providerTasks);
        expect(f.providerFetch).not.toHaveBeenCalled(); expect(f.moderator.status().used).toBe(1); expect(f.engine.adminState().aiReviews).toEqual([]);
    });
    it('uses the explicit dispatch-start fence for qualified calls and denies expiry or a missing validation ticket at start', async () => {
        const positive = await setup({ provider: true }); await positive.connect('alice'); await positive.connect('bravo');
        await positive.message('alice', { t: 'say', ch: '#stalemate', text: 'Benign permitted provider fixture' }); await Promise.all(positive.providerTasks); expect(positive.providerFetch).toHaveBeenCalledTimes(1);
        for (const mode of ['expiry', 'validation']) {
            const f = await setup({ provider: true }); await f.connect('alice'); await f.connect('bravo');
            if (mode === 'expiry') f.controls.afterValidate = () => f.advance(10001); else f.controls.skipValidate = true;
            await f.message('alice', { t: 'say', ch: '#stalemate', text: `Benign denied provider ${mode}` }); await Promise.all(f.providerTasks);
            expect(f.providerFetch).not.toHaveBeenCalled();
        }
    });
    it('drops an already-started provider result after withdrawal without reviving a grant or review record', async () => {
        const f = await setup({ provider: true }); await f.connect('alice'); await f.connect('bravo'); const held = gate();
        f.providerFetch.mockImplementationOnce(async () => {
            await held.wait(); return new Response(JSON.stringify({ model: 'synthetic_model', results: [{ flagged: true,
                categories: Object.fromEntries(AI_CATEGORIES.map(key => [key, key === 'harassment'])),
                category_scores: Object.fromEntries(AI_CATEGORIES.map(key => [key, key === 'harassment' ? 0.8 : 0])) }] }));
        });
        await f.message('alice', { t: 'say', ch: '#stalemate', text: 'Benign late response fixture' }); await held.entered;
        expect(f.providerFetch).toHaveBeenCalledTimes(1); await f.withdraw(); held.release(); await Promise.all(f.providerTasks);
        expect(f.engine.adminState().aiReviews).toEqual([]); expect((await f.ledger.lookup(f.alice.proof)).subject.state).toBe('withdrawn');
    });
});

async function cohortEnforcerFixture() {
    const f = await setup(); await f.connect('alice'); await f.connect('bravo');
    const connections = ['alice', 'bravo'].map(id => ({ id, ...clone(f.sessionBindings.get(id)) }));
    const individual = vi.fn(async connection => clone(f.identities.get(connection.id)));
    const bulk = vi.fn(async values => values.map(connection => clone(f.identities.get(connection.id)) ?? null));
    const writes = vi.fn(async ({ tx, effects }) => {
        for (const [kind, value] of effects) await tx.put('cohort:' + kind, value);
    });
    const make = extra => createParticipationEnforcement({ storage: f.storage, now: f.now, resolveConnection: individual,
        validateConnection: f.validateConnection, writeEffects: writes, providerQualified: () => true,
        dispatchStart: f.storage.dispatchStart, ...extra });
    return { f, connections, individual, bulk, writes, make };
}

describe('optional cohort preparation with real C2 permission reads', () => {
    it.each([false, true])('uses legacy individual preparation only when the optional method is absent/undefined (%s)', async explicitUndefined => {
        const f = await cohortEnforcerFixture(), adapter = f.make(explicitUndefined ? { resolveConnections: undefined } : {});
        const before = f.f.storage.snapshot(), context = await adapter.prepare(f.connections);
        expect(f.individual).toHaveBeenCalledTimes(2); expect(f.bulk).not.toHaveBeenCalled();
        expect(adapter.allows(context, { actorId: 'alice', action: 'publicText' })).toBe(true);
        expect(f.f.storage.snapshot()).toEqual(before);
        expect(await adapter.commit(context, [['net', { synthetic: 'legacy still works' }]])).toEqual({ ok: true });
        expect(f.f.storage.snapshot().get('cohort:net')).toEqual({ synthetic: 'legacy still works' });
    });

    it.each([null, {}, true])('rejects an explicitly invalid optional adapter instead of treating it as absent (%s)', value => {
        expect(() => createParticipationEnforcement({ storage: store(), resolveConnection: async () => null,
            validateConnection: async () => false, writeEffects: async () => {}, resolveConnections: value })).toThrow(TypeError);
    });

    it('uses ordered nullable cohort slots and keeps adapter mutations outside the caller/context descriptors', async () => {
        const f = await cohortEnforcerFixture(), original = clone(f.connections);
        const bulk = vi.fn(async values => {
            const result = [clone(f.f.identities.get(values[0].id)), null];
            values[0].id = 'adapter_mutated_copy'; return result;
        });
        const adapter = f.make({ resolveConnections: bulk }), before = f.f.storage.snapshot();
        const context = await adapter.prepare(f.connections);
        expect(bulk).toHaveBeenCalledTimes(1); expect(f.individual).not.toHaveBeenCalled(); expect(f.connections).toEqual(original);
        expect(adapter.allows(context, { actorId: 'alice', action: 'publicText' })).toBe(true);
        expect(adapter.allows(context, { actorId: 'bravo', action: 'publicText' })).toBe(false);
        expect(adapter.allows(context, { actorId: 'adapter_mutated_copy', action: 'publicText' })).toBe(false);
        expect(f.f.storage.snapshot()).toEqual(before);
        expect(await adapter.commit(context, [['net', { synthetic: 'current alice only' }]])).toEqual({ ok: true });
        expect(f.individual).toHaveBeenCalledTimes(1); expect(bulk).toHaveBeenCalledTimes(1);
    });

    it.each(['throw', 'not array', 'wrong length', 'sparse', 'undefined slot', 'extra identity field', 'identity accessor', 'nonplain array'])(
        'fails closed without individual fallback on %s cohort output', async damage => {
            const f = await cohortEnforcerFixture(), alice = clone(f.f.identities.get('alice')), bravo = clone(f.f.identities.get('bravo'));
            const bulk = vi.fn(async () => {
                if (damage === 'throw') throw Error('Synthetic cohort authority unavailable');
                if (damage === 'not array') return null;
                if (damage === 'wrong length') return [alice];
                if (damage === 'sparse') { const values = new Array(2); values[0] = alice; return values; }
                if (damage === 'undefined slot') return [alice, undefined];
                if (damage === 'extra identity field') return [{ ...alice, role: 'owner' }, bravo];
                if (damage === 'identity accessor') {
                    Object.defineProperty(alice, 'expiresAt', { enumerable: true, get() { throw Error('Synthetic accessor'); } });
                    return [alice, bravo];
                }
                return Object.setPrototypeOf([alice, bravo], null);
            });
            const adapter = f.make({ resolveConnections: bulk }), before = f.f.storage.snapshot();
            const context = await adapter.prepare(f.connections);
            expect(adapter.allows(context, { actorId: 'alice', action: 'publicText' })).toBe(false);
            expect(adapter.allows(context, { actorId: 'bravo', action: 'publicText' })).toBe(false);
            expect(f.individual).not.toHaveBeenCalled(); expect(f.writes).not.toHaveBeenCalled();
            expect(f.f.storage.snapshot()).toEqual(before);
        });

    it('prepares again from fresh cohort identities and does not use a previous affirmative result', async () => {
        const f = await cohortEnforcerFixture(), adapter = f.make({ resolveConnections: f.bulk });
        const first = await adapter.prepare(f.connections);
        expect(adapter.allows(first, { actorId: 'alice', action: 'publicText' })).toBe(true);
        f.f.identities.get('alice').expiresAt = f.f.now();
        const second = await adapter.prepare(f.connections);
        expect(adapter.allows(second, { actorId: 'alice', action: 'publicText' })).toBe(false);
        expect(adapter.allows(second, { actorId: 'bravo', action: 'publicText' })).toBe(true);
        expect(f.bulk).toHaveBeenCalledTimes(2); expect(f.individual).not.toHaveBeenCalled();
    });

    it('does not reuse preparation grants for commit or provider fences after real C2 withdrawal', async () => {
        const f = await cohortEnforcerFixture(), adapter = f.make({ resolveConnections: f.bulk }), context = await adapter.prepare(f.connections);
        const text = { actorId: 'alice', action: 'publicText' }, ai = { actorId: 'alice', action: 'aiPublicReview', providerReady: true, publicTextEligible: true };
        expect(adapter.allows(context, text)).toBe(true); expect(adapter.allows(context, ai)).toBe(true);
        expect((await f.f.withdraw('alice')).state).toBe('withdrawn');
        const start = vi.fn();
        expect((await adapter.commit(context, [['net', { never: 'withdrawn publication' }]])).ok).toBe(false);
        expect(await adapter.providerAllowed(context, ai)).toBe(false);
        await expect(adapter.startProvider(context, ai, start)).rejects.toThrow();
        expect(start).not.toHaveBeenCalled(); expect(f.writes).not.toHaveBeenCalled();
        expect(f.f.storage.snapshot().has('cohort:net')).toBe(false);
        expect(f.individual).toHaveBeenCalled(); expect(f.bulk).toHaveBeenCalledTimes(1);
    });

    it('rechecks the individual session fence even while the C2 grant remains valid', async () => {
        const f = await cohortEnforcerFixture(), adapter = f.make({ resolveConnections: f.bulk }), context = await adapter.prepare(f.connections);
        expect(adapter.allows(context, { actorId: 'alice', action: 'publicText' })).toBe(true);
        f.f.identities.delete('alice');
        expect((await adapter.commit(context, [['net', { never: 'revoked session' }]])).ok).toBe(false);
        expect(f.writes).not.toHaveBeenCalled(); expect(f.individual).toHaveBeenCalledTimes(1);
        expect(f.bulk).toHaveBeenCalledTimes(1);
    });
});
