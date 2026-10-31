// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';

let now, engine, frames, writes, count, identities;
const cmd = (id, name, args = [], ch = '#stalemate') => engine.message(id, JSON.stringify({ t: 'cmd', name, args, ch }));
function boot() {
    frames = []; writes = [];
    engine = createLobby({ now: () => now, send: (recipient, frame) => frames.push({ recipient, ...frame }),
        persist: (kind, value) => writes.push([kind, structuredClone(value)]), limits: { defaultSlow: 0 } });
}
function guest(nick, extra = {}) {
    const identity = { id: `socket${++count}`, dev: `dev-${nick}`, iph: `iph-${nick}`, role: 'fan', account: '', admin: false, ...extra };
    identities.push(identity);
    engine.connect(identity); engine.message(identity.id, JSON.stringify({ t: 'hello', nick, age13: true }));
    return identity.id;
}
function state() { return { sessions: engine.sessionSnapshot(), rooms: engine.roomSnapshot(), net: engine.snapshot(), abuse: engine.abuseSnapshot() }; }
function wake(saved, live = identities) {
    boot(); engine.restore(saved.net); engine.restoreRooms(saved.rooms); engine.restoreAbuse(saved.abuse);
    return engine.restoreSessions(saved.sessions, live);
}
beforeEach(() => { now = 1800000000000; count = 0; identities = []; boot(); });

describe('same-WebSocket hibernation continuity', () => {
    it('keeps nicknames, membership, preferences and current cam consent without a fresh handshake or history', () => {
        const a = guest('Painter', { account: 'account-painter' }); const b = guest('Viewer');
        cmd(a, 'join', ['#art-friends']); cmd(a, 'register', [], '#art-friends'); cmd(b, 'join', ['#art-friends']);
        cmd(a, 'away', ['making coffee']); cmd(a, 'ignore', ['Someone']); cmd(a, 'block', ['Viewer']); cmd(a, 'pm', ['off']);
        engine.message(a, JSON.stringify({ t: 'cam', ch: '#art-friends', on: true, adult18: true }));
        engine.message(b, JSON.stringify({ t: 'say', ch: '#art-friends', text: 'Ephemeral public sentence' }));
        const saved = state(); now += 61000;
        const result = wake(saved); expect(result).toEqual({ resumed: [a, b], rejected: [] });
        const resumed = engine._debug.conns.get(a);
        expect(resumed).toMatchObject({ nick: 'Painter', away: 'making coffee', pmOff: true, since: saved.sessions.connections[0].since });
        expect([...resumed.channels]).toEqual(['#stalemate', '#art-friends']); expect([...resumed.ignores]).toContain('someone');
        expect([...resumed.blocks]).toContain('dev-Viewer'); expect([...resumed.cams]).toEqual(['#art-friends']);
        expect([...engine._debug.channels.get('#art-friends').members]).toEqual([a, b]); expect(frames).toEqual([]);
        engine.message(b, JSON.stringify({ t: 'say', ch: '#art-friends', text: 'After the idle wake' }));
        expect(frames.some((f) => f.t === 'line' && f.text === 'After the idle wake')).toBe(true);
        expect(frames.some((f) => ['hello', 'welcome', 'join'].includes(f.t))).toBe(false);
        expect(JSON.stringify(saved.sessions)).not.toContain('Ephemeral public sentence');
    });
    it('preserves accepted PM consent but stores no pending first messages or PM bodies', () => {
        const a = guest('Alice'); const b = guest('Bravo'); const c = guest('Charlie'); now += 3 * 60000;
        cmd(a, 'msg', ['Bravo', 'Private accepted words']); cmd(b, 'accept', ['Alice']);
        cmd(a, 'msg', ['Charlie', 'Pending private secret']);
        const saved = state();
        expect(saved.sessions.pm).toHaveLength(1); expect(JSON.stringify(saved.sessions)).not.toContain('Private accepted words');
        expect(JSON.stringify(saved.sessions)).not.toContain('Pending private secret');
        expect(saved.sessions.pendingPm).toHaveLength(1);
        expect(wake(saved).resumed).toHaveLength(3); expect(engine._debug.pm.size).toBe(2);
        cmd(a, 'msg', ['Bravo', 'New private sentence']);
        expect(frames.some((f) => f.recipient === b && f.t === 'pm' && f.text === 'New private sentence')).toBe(true);
        expect(frames.some((f) => f.t === 'pm-request')).toBe(false);
        expect(engine._debug.conns.get(c).nick).toBe('Charlie');
    });
    it('restores only actual live socket IDs and never grants a reconnect the old session by nickname or device', () => {
        const a = guest('Alice'); const b = guest('Bravo'); const saved = state();
        const replacement = { ...identities[0], id: 'different-socket' };
        const result = wake(saved, [identities[1], replacement]);
        expect(result.resumed).toEqual([b]); expect(result.rejected).toEqual([{ id: 'different-socket', reason: 'session-identity' }]);
        expect(engine._debug.conns.has(a)).toBe(false); expect(engine._debug.channels.get('#stalemate').members.size).toBe(1);
    });
    it.each([
        ['device', { dev: 'wrong-device' }], ['account', { account: 'wrong-account' }], ['role', { role: 'moderator' }],
        ['expiry', { expiresAt: 1800000000000 }], ['staff scope', { admin: true }]
    ])('refuses a changed %s identity', (_label, change) => {
        const a = guest('Alice'); const saved = state(); const result = wake(saved, [{ ...identities[0], ...change }]);
        expect(result.resumed).toEqual([]); expect(result.rejected[0].id).toBe(a); expect(engine._debug.conns.size).toBe(0);
    });
    it('enforces current network and room bans on restored sockets', () => {
        const a = guest('Alice'); cmd(a, 'join', ['#friends']); const saved = state();
        saved.rooms.rooms[0].bans.push({ mask: 'dev:dev-Alice', reason: 'fixture' });
        expect(wake(saved).rejected).toEqual([{ id: a, reason: 'session-room' }]);
        saved.rooms.rooms[0].bans = []; saved.net.bans.push({ mask: 'account:account-a' });
        saved.sessions.connections[0].account = 'account-a';
        expect(wake(saved, [{ ...identities[0], account: 'account-a' }]).rejected).toEqual([{ id: a, reason: 'session-admission' }]);
    });
    it('retains already joined members when hosts lock or key their room, while applying camera safety settings', () => {
        const a = guest('Alice'); const b = guest('Bravo'); cmd(a, 'join', ['#art-friends']); cmd(b, 'join', ['#art-friends']);
        engine.message(b, JSON.stringify({ t: 'cam', ch: '#art-friends', on: true, adult18: true }));
        const saved = state(); saved.rooms.rooms[0].modes.i = true; saved.rooms.rooms[0].modes.k = 'secret'; saved.rooms.rooms[0].modes.locked = true; saved.net.shield = true;
        expect(wake(saved).resumed).toEqual([a, b]); expect(engine._debug.conns.get(b).cams.size).toBe(0);
        expect(frames).toEqual([{ recipient: b, t: 'cam', ch: '#art-friends', on: false, by: 'StaleBot' }]);
    });
    it('does not restore disconnected devices, camera activation or PM consent into new connections', () => {
        const a = guest('Alice'); const b = guest('Bravo'); now += 3 * 60000;
        cmd(a, 'query', ['Bravo']); cmd(b, 'accept', ['Alice']); engine.disconnect(a);
        const saved = state(); expect(saved.sessions.connections.map((s) => s.id)).toEqual([b]); expect(saved.sessions.pm).toEqual([]);
        expect(wake(saved, [identities[1]]).resumed).toEqual([b]);
        const fresh = guest('AliceAgain', { dev: 'dev-Alice' }); expect(engine._debug.conns.get(fresh).cams.size).toBe(0); expect(engine._debug.pm.size).toBe(0);
    });
    it('fails closed on corrupt, oversized or missing metadata', () => {
        const a = guest('Alice'); const saved = state(); saved.sessions.connections[0].channels = ['#missing'];
        expect(wake(saved).rejected).toEqual([{ id: a, reason: 'session-room' }]);
        saved.sessions.connections[0].channels = ['#stalemate']; saved.sessions.connections[0].ignores = ['x'.repeat(3 * 1024 * 1024)];
        expect(wake(saved).rejected).toEqual([{ id: a, reason: 'session-invalid' }]);
        saved.sessions = undefined; expect(wake(saved).rejected).toEqual([{ id: a, reason: 'session-missing' }]);
    });
    it('awaits session persistence before acknowledging a nickname and caps ignores without dropping existing preferences', async () => {
        const a = guest('Alice', { role: 'owner' });
        for (let i = 0; i < 51; i++) cmd(a, 'ignore', [`Visitor${i}`]);
        expect(engine._debug.conns.get(a).ignores.size).toBe(50); expect(engine._debug.conns.get(a).ignores.has('visitor0')).toBe(true);
        expect(engine._debug.conns.get(a).ignores.has('visitor50')).toBe(false);
        expect(new TextEncoder().encode(JSON.stringify(engine.sessionSnapshot())).byteLength).toBeLessThan(2 * 1024 * 1024);
        expect(writes.some(([kind]) => kind === 'sessions')).toBe(true);
        let finish;
        frames = [];
        engine = createLobby({ now: () => now, send: (_id, frame) => frames.push(frame), persist: (kind) => kind === 'sessions' ? new Promise((yes) => { finish = yes; }) : undefined });
        engine.connect({ id: 'pending', dev: 'dev-pending', iph: 'iph-pending' });
        const pending = engine.message('pending', JSON.stringify({ t: 'hello', nick: 'NewVisitor', age13: true }));
        expect(frames.some((f) => f.t === 'welcome')).toBe(false); finish(); await pending;
        expect(frames.some((f) => f.t === 'welcome')).toBe(true);
    });
});
