// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';

let now, engine, frames, writes, identities, sequence;
function boot(persist) {
    frames = []; writes = [];
    engine = createLobby({ now: () => now, send: (recipient, frame) => frames.push({ recipient, ...frame }),
        persist: persist || ((kind, value) => writes.push([kind, structuredClone(value)])), limits: { defaultSlow: 0 } });
}
function guest(nick, role = 'fan', dev = `dev-${nick}`) {
    const identity = { id: `socket${++sequence}`, dev, iph: `ip-${sequence}`, role, admin: role === 'owner', account: '' };
    identities.push(identity); expect(engine.connect(identity).ok).toBe(true);
    engine.message(identity.id, JSON.stringify({ t: 'hello', nick, age13: true }));
    return identity.id;
}
const cmd = (id, name, args = [], ch = '#stalemate') => engine.message(id, JSON.stringify({ t: 'cmd', name, args, ch }));
function say(id, text, ch = '#stalemate') {
    now += 4000; engine.message(id, JSON.stringify({ t: 'say', text, ch }));
    return frames.filter((f) => f.recipient === id && f.t === 'line').at(-1);
}
const report = (id, line, changes = {}) => engine.message(id, JSON.stringify({ t: 'report', id: line.id, text: line.text, ...changes }));
const snapshot = () => ({ sessions: structuredClone(engine.sessionSnapshot()), rooms: structuredClone(engine.roomSnapshot()), net: structuredClone(engine.snapshot()) });
function wake(saved, live = identities) {
    now += 61000; boot(); engine.restore(saved.net); engine.restoreRooms(saved.rooms);
    return engine.restoreSessions(saved.sessions, live);
}
beforeEach(() => { now = 1800000000000; sequence = 0; identities = []; boot(); });

describe('durable delivery receipts without a saved chat backlog', () => {
    it('accepts an exact previously delivered line after a same-socket wake without retaining or replaying text', () => {
        const sender = guest('Sender'); const witness = guest('Witness');
        const line = say(sender, 'Visible before the server sleeps'); const saved = snapshot();
        expect(JSON.stringify(saved.sessions)).not.toContain(line.text);
        expect(saved.sessions.receipts).toEqual([expect.objectContaining({ id: line.id, from: 'Sender', authorDev: 'dev-Sender',
            digest: expect.stringMatching(/^[a-f0-9]{64}$/), recipients: [sender, witness] })]);
        expect(wake(saved).resumed).toEqual([sender, witness]); expect(frames).toEqual([]);
        expect(engine._debug.lines.size).toBe(0);
        report(witness, line);
        expect(engine.adminState().reports).toEqual([expect.objectContaining({ id: line.id, from: 'Sender', text: line.text, count: 1 })]);
        expect(writes.filter(([kind]) => kind === 'moderation-queue').at(-1)[1].reports[0].text).toBe(line.text);
        expect(frames.filter((f) => f.t === 'line')).toEqual([]);
    });

    it('rejects fabricated text, another message ID and forged author/channel fields', () => {
        const sender = guest('Sender'); const witness = guest('Witness');
        const line = say(sender, 'Actual delivered sentence'); const other = say(sender, 'Another delivered sentence');
        wake(snapshot());
        report(witness, line, { text: 'Fabricated abuse' });
        report(witness, line, { id: other.id });
        expect(engine.adminState().reports).toEqual([]);
        report(witness, line, { from: 'SomeoneElse', ch: '#invented', authorDev: 'other-device' });
        expect(engine.adminState().reports[0]).toMatchObject({ from: 'Sender', ch: '#stalemate', text: line.text });
    });

    it('denies outsiders, ignored visitors, reconnects and the author while preserving an actual witness after part', () => {
        const sender = guest('Sender'); const witness = guest('Witness'); const ignored = guest('Ignored'); const outside = guest('Outside');
        cmd(sender, 'join', ['#sealed']); cmd(sender, 'mode', ['+k', 'secret'], '#sealed');
        cmd(witness, 'join', ['#sealed', 'secret']); cmd(ignored, 'join', ['#sealed', 'secret']); cmd(ignored, 'ignore', ['Sender']);
        const line = say(sender, 'Only the actual witnesses may report this', '#sealed'); cmd(witness, 'part', [], '#sealed');
        const saved = snapshot(); wake(saved);
        report(outside, line); report(ignored, line); report(sender, line);
        const fresh = guest('ReturningWitness', 'fan', 'dev-Witness'); report(fresh, line);
        expect(engine.adminState().reports).toEqual([]);
        report(witness, line); expect(engine.adminState().reports[0]).toMatchObject({ id: line.id, count: 1 });
    });

    it('restores report eligibility for accepted PMs without storing a PM body or disclosing it to other visitors', () => {
        const sender = guest('Sender'); const witness = guest('Witness'); const outsider = guest('Outside'); now += 180000;
        cmd(sender, 'msg', ['Witness', 'Consented private sentence']); cmd(witness, 'accept', ['Sender']);
        const line = frames.filter((f) => f.recipient === witness && f.t === 'pm').at(-1);
        const saved = snapshot(); expect(JSON.stringify(saved.sessions)).not.toContain(line.text);
        wake(saved); report(outsider, line); expect(engine.adminState().reports).toEqual([]);
        report(witness, line); expect(engine.adminState().reports[0]).toMatchObject({ text: line.text, ch: 'pm:Sender>Witness' });
        expect(frames.filter((f) => ['line', 'pm'].includes(f.t))).toEqual([]);
    });

    it('keeps original author attribution after nickname reuse and never revives deleted receipts', () => {
        const sender = guest('SameNick'); const witness = guest('Witness'); const staff = guest('Staff', 'owner');
        const line = say(sender, 'The original author is responsible'); now += 61000; cmd(sender, 'nick', ['Renamed']);
        const newcomer = guest('SameNick', 'fan', 'different-device');
        const saved = snapshot(); wake(saved); report(witness, line);
        expect(writes.filter(([kind]) => kind === 'moderation-queue').at(-1)[1].reports[0].authorDev).toBe('dev-SameNick');
        cmd(staff, 'delete', [line.id]); expect(engine.sessionSnapshot().receipts).toEqual([]);
        const afterDelete = snapshot(); wake(afterDelete); report(witness, line);
        expect(engine.adminState().reports).toEqual([]); expect(engine._debug.conns.get(newcomer).nick).toBe('SameNick');
    });

    it('bounds count and expires receipt metadata after 24 hours with a durable removal', () => {
        const sender = guest('Sender', 'owner'); guest('Witness'); let first;
        for (let i = 0; i < 1003; i += 1) { const line = say(sender, `Bounded receipt ${i}`); if (!first) first = line; }
        const current = engine.sessionSnapshot(); expect(current.receipts).toHaveLength(1000);
        expect(current.receipts.some((r) => r.id === first.id)).toBe(false);
        expect(new TextEncoder().encode(JSON.stringify(current.receipts)).byteLength).toBeLessThanOrEqual(1024 * 1024);
        now += 86400000; engine.tick();
        expect(engine.sessionSnapshot().receipts).toEqual([]);
        expect(writes.filter(([kind]) => kind === 'sessions').at(-1)[1].receipts).toEqual([]);
    });

    it('allows moderators to purge or delete still-visible lines after wake without restoring their text', () => {
        const sender = guest('Sender'); guest('Witness'); const staff = guest('Staff', 'owner');
        const first = say(sender, 'First delivered sentence'); const second = say(sender, 'Second delivered sentence');
        const third = say(staff, 'A separate staff sentence');
        wake(snapshot()); expect(engine._debug.lines.size).toBe(0);
        cmd(staff, 'delete', [first.id]);
        expect(frames.some((f) => f.t === 'delete' && f.ids.includes(first.id))).toBe(true);
        cmd(staff, 'purge', ['Sender']);
        expect(frames.some((f) => f.t === 'delete' && f.ids.includes(second.id))).toBe(true);
        expect(engine.sessionSnapshot().receipts.map((r) => r.id)).toEqual([third.id]);
        expect(frames.filter((f) => f.t === 'line')).toEqual([]);
    });

    it('enforces the byte cap even when every line has 200 delivery witnesses', () => {
        const crowded = createLobby({ now: () => now, limits: { defaultSlow: 0 } });
        const ids = Array.from({ length: 200 }, (_, i) => `crowd${i}-${'x'.repeat(100)}`);
        ids.forEach((id, i) => {
            expect(crowded.connect({ id, dev: `dev-${i}`, iph: `ip-${i}`, role: 'owner' }).ok).toBe(true);
            crowded.message(id, JSON.stringify({ t: 'hello', nick: `Crowd${i}`, age13: true }));
        });
        for (let i = 0; i < 100; i += 1) { now += 4000; crowded.message(ids[0], JSON.stringify({ t: 'say', ch: '#stalemate', text: `A crowded message ${i}` })); }
        const state = crowded.sessionSnapshot();
        expect(state.receipts.length).toBeGreaterThan(0); expect(state.receipts.length).toBeLessThan(100);
        expect(new TextEncoder().encode(JSON.stringify(state.receipts)).byteLength).toBeLessThanOrEqual(1024 * 1024);
        expect(new TextEncoder().encode(JSON.stringify(state)).byteLength).toBeLessThan(2 * 1024 * 1024);
        expect(state.receipts.at(-1).recipients).toHaveLength(200);
    });

    it('reclaims witness bytes on disconnect without unnecessarily evicting still-reportable lines', () => {
        const crowded = createLobby({ now: () => now, limits: { defaultSlow: 0 } });
        const ids = Array.from({ length: 200 }, (_, i) => `crowd${i}-${'x'.repeat(100)}`);
        ids.forEach((id, i) => {
            crowded.connect({ id, dev: `dev-${i}`, iph: `ip-${i}`, role: 'owner' });
            crowded.message(id, JSON.stringify({ t: 'hello', nick: `Crowd${i}`, age13: true }));
        });
        const publish = (text) => { now += 4000; crowded.message(ids[0], JSON.stringify({ t: 'say', ch: '#stalemate', text })); };
        for (let i = 0; i < 100; i++) publish(`Crowded line ${i}`);
        const initial = crowded.sessionSnapshot().receipts;
        for (const id of ids.slice(2)) crowded.disconnect(id);
        for (let i = 0; i < 100; i++) publish(`Two remaining witnesses ${i}`);
        const current = crowded.sessionSnapshot().receipts;
        expect(current).toHaveLength(initial.length + 100);
        expect(current[0].id).toBe(initial[0].id);
        expect(current.every((r) => r.recipients.length === 2)).toBe(true);
        expect(new TextEncoder().encode(JSON.stringify(current)).byteLength).toBeLessThanOrEqual(1024 * 1024);
    });

    it('keeps an outstanding durable snapshot immutable when later witnesses leave or evidence is deleted', () => {
        const captured = [];
        boot((kind, value) => { if (kind === 'sessions') captured.push(value); });
        const sender = guest('Sender', 'owner'), witness = guest('Witness');
        const line = say(sender, 'A digest-only immutable delivery snapshot');
        const original = captured.at(-1), expected = JSON.stringify(original);
        engine.disconnect(witness);
        expect(captured.at(-1).receipts[0].recipients).toEqual([sender]);
        cmd(sender, 'delete', [line.id]);
        expect(captured.at(-1).receipts).toEqual([]);
        expect(JSON.stringify(original)).toBe(expected);
        expect(expected).not.toContain(line.text);
    });

    it('retains no delivery receipt for a line received by nobody', () => {
        const sender = guest('Sender', 'owner');
        cmd(sender, 'ignore', ['Sender']);
        say(sender, 'No one receives this line');
        expect(engine.sessionSnapshot().receipts).toEqual([]);
        cmd(sender, 'unignore', ['Sender']);
        say(sender, 'This line has an actual recipient');
        expect(engine.sessionSnapshot().receipts).toHaveLength(1);
    });

    it('drops malformed or oversized receipts without granting reports or resetting valid live sessions', () => {
        const sender = guest('Sender'); const witness = guest('Witness'); const line = say(sender, 'An authentic sentence');
        const saved = snapshot(); saved.sessions.receipts[0].digest = 'invalid';
        expect(wake(saved).resumed).toEqual([sender, witness]); report(witness, line);
        expect(engine.adminState().reports).toEqual([]); expect(engine.sessionSnapshot().receipts).toEqual([]);
        saved.sessions.receipts = Array(1001).fill({});
        expect(wake(saved).resumed).toEqual([sender, witness]); expect(engine.sessionSnapshot().receipts).toEqual([]);
        delete saved.sessions.receipts;
        expect(wake(saved).resumed).toEqual([sender, witness]);
    });
});

describe('durable report acknowledgement', () => {
    it('holds the success acknowledgement until evidence is stored', async () => {
        let finish;
        boot((kind) => kind === 'moderation-queue' ? new Promise((resolve) => { finish = resolve; }) : undefined);
        const sender = guest('Sender'); const witness = guest('Witness'); const line = say(sender, 'Evidence needs reliable storage');
        frames = []; const pending = report(witness, line);
        expect(frames.some((f) => /Reported to/.test(f.text || ''))).toBe(false);
        finish(); await pending;
        expect(frames.some((f) => f.recipient === witness && /Reported to/.test(f.text || ''))).toBe(true);
    });

    it('does not claim success when evidence storage rejects and informs the visitor', async () => {
        boot((kind) => kind === 'moderation-queue' ? Promise.reject(new Error('storage fixture unavailable')) : undefined);
        const sender = guest('Sender'); const witness = guest('Witness'); const line = say(sender, 'Evidence storage failure case');
        frames = []; await report(witness, line);
        expect(frames.some((f) => /Reported to/.test(f.text || ''))).toBe(false);
        expect(frames.some((f) => f.t === 'report-status')).toBe(false);
        expect(frames.some((f) => f.recipient === witness && f.kind === 'error' && /Storage is unavailable/.test(f.text))).toBe(true);
        expect(engine.snapshot()).toMatchObject({ lock: 'readonly', lockAuto: true });
    });

    it('stores a previously failed in-memory report before acknowledging a duplicate retry without adding a vote', async () => {
        let available = false; let attempts = 0;
        boot((kind) => {
            if (kind !== 'moderation-queue') return;
            attempts += 1;
            return available ? Promise.resolve() : Promise.reject(new Error('temporary fixture failure'));
        });
        const sender = guest('Sender'); const witness = guest('Witness'); const line = say(sender, 'Retry the same evidence safely');
        await report(witness, line); expect(attempts).toBe(1);
        available = true; frames = []; await report(witness, line);
        expect(attempts).toBe(2); expect(engine.adminState().reports[0].count).toBe(1);
        expect(frames).toContainEqual({ recipient: witness, t: 'report-status', id: line.id, submitted: true });
        expect(frames.some((f) => /Already reported/.test(f.text || ''))).toBe(true);
    });
});
