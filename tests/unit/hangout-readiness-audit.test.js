// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';

let engine, frames, closes, now, seq;
const cmd = (id, name, args = [], ch = '#stalemate') => engine.message(id, JSON.stringify({ t: 'cmd', name, args, ch }));
function guest(nick, extra = {}) {
    const id = `c${++seq}`;
    engine.connect({ id, dev: `dev-${nick}`, iph: `ip-${nick}`, ...extra });
    engine.message(id, JSON.stringify({ t: 'hello', nick, age13: true }));
    return id;
}
function boot(limits = {}) {
    frames = []; closes = []; seq = 0;
    engine = createLobby({ now: () => now, send: (id, frame) => frames.push({ recipient: id, ...frame }), close: (...args) => closes.push(args), limits: { defaultSlow: 0, ...limits } });
}
beforeEach(() => { now = 1800000000000; boot(); });

describe('restricted room privacy', () => {
    it.each(['+i', '+k', 'locked'])('keeps %s room metadata out of outsider commands', (restriction) => {
        const owner = guest('Owner', { account: 'account-owner' });
        cmd(owner, 'join', ['#secret']); cmd(owner, 'register', [], '#secret');
        cmd(owner, 'topic', ['Private rehearsal'], '#secret');
        if (restriction === 'locked') cmd(owner, 'lock', [], '#secret');
        else cmd(owner, 'mode', [restriction, 'secretkey'], '#secret');
        const outsider = guest('Outsider'); frames.length = 0;
        cmd(outsider, 'names', ['#secret']); cmd(outsider, 'topic', [], '#secret'); cmd(outsider, 'whois', ['Owner']);
        const notices = frames.filter((f) => f.recipient === outsider).map((f) => f.text).join('\n');
        expect(notices).not.toContain('#secret'); expect(notices).not.toContain('Private rehearsal'); expect(notices).not.toContain('@Owner');
        cmd(owner, 'names', ['#secret']); cmd(owner, 'topic', [], '#secret');
        expect(frames.filter((f) => f.recipient === owner).map((f) => f.text).join('\n')).toContain('Private rehearsal');
    });
    it('does not let a nonmember edit a public room topic even when -t permits ordinary members', () => {
        const owner = guest('Owner'); cmd(owner, 'join', ['#friends']); cmd(owner, 'mode', ['-t'], '#friends');
        const outsider = guest('Outsider'); cmd(outsider, 'topic', ['Unwanted topic'], '#friends');
        expect(engine._debug.channels.get('#friends').topic).toBe('');
    });
});

describe('identity-wide bans and owner protection', () => {
    it('removes every active connection matching a network account or device ban', () => {
        const target = guest('Alice', { account: 'account-alice' });
        const sameAccount = guest('OtherDevice', { account: 'account-alice' });
        const sameDevice = guest('AnotherTab', { dev: 'dev-Alice' });
        const bystander = guest('Bystander'); const mod = guest('Helper', { role: 'moderator' });
        cmd(mod, 'gban', ['Alice', 'Repeated abuse']);
        for (const id of [target, sameAccount, sameDevice]) expect(engine._debug.conns.has(id)).toBe(false);
        expect(engine._debug.conns.has(bystander)).toBe(true);
        frames.length = 0;
        engine.message(sameAccount, JSON.stringify({ t: 'say', ch: '#stalemate', text: 'Still here' }));
        expect(frames.some((f) => f.t === 'line')).toBe(false);
        expect(closes.filter(([, code]) => code === 4003)).toHaveLength(3);
    });
    it('protects a registered owner from guest and verified co-host kick/ban', () => {
        const owner = guest('Owner', { account: 'account-owner' }); cmd(owner, 'join', ['#friends']); cmd(owner, 'register', [], '#friends');
        const host = guest('Cohost', { account: 'account-host' }); cmd(host, 'join', ['#friends']); cmd(owner, 'cohost', ['add', 'Cohost'], '#friends');
        cmd(host, 'kick', ['Owner'], '#friends'); cmd(host, 'ban', ['Owner', 'Cannot remove owner'], '#friends');
        const room = engine._debug.channels.get('#friends');
        expect(room.members.has(owner)).toBe(true); expect(room.bans).toEqual([]); expect(room.kicks['dev-Owner']).toBeUndefined();
    });
    it('lets the owner recover access when a legacy room ban matches their account', () => {
        const owner = guest('Owner', { account: 'account-owner' }); cmd(owner, 'join', ['#friends']); cmd(owner, 'register', [], '#friends');
        const room = engine._debug.channels.get('#friends'); room.bans.push({ mask: 'account:account-owner' });
        cmd(owner, 'part', [], '#friends'); cmd(owner, 'join', ['#friends']); expect(room.members.has(owner)).toBe(true);
    });
    it('removes existing alternate devices when a room account ban is applied', () => {
        const owner = guest('Owner'); cmd(owner, 'join', ['#friends']);
        const target = guest('Alice', { account: 'account-alice' }); const other = guest('OtherDevice', { account: 'account-alice' });
        cmd(target, 'join', ['#friends']); cmd(other, 'join', ['#friends']); cmd(owner, 'ban', ['Alice', 'Repeated abuse'], '#friends');
        const room = engine._debug.channels.get('#friends');
        expect(room.members.has(target)).toBe(false); expect(room.members.has(other)).toBe(false);
        expect(engine._debug.conns.has(other)).toBe(true);
    });
});

describe('aggregate room storage allowance', () => {
    it('refuses excess paint without changing or broadcasting the canvas and permits clearing', () => {
        boot({ roomStateBytes: 32768 });
        const owner = guest('Painter'); cmd(owner, 'join', ['#art-friends']);
        const room = engine._debug.channels.get('#art-friends');
        let refused = false;
        for (let n = 0; n < 30; n++) {
            now += 1000;
            const before = structuredClone(room.act.strokes); frames.length = 0;
            engine.message(owner, JSON.stringify({ t: 'act', ch: '#art-friends', kind: 'stroke', stroke: { id: `stroke-${n}`, color: '#009ee8', size: 8, pts: Array.from({ length: 80 }, (_, i) => [i / 100, (i + 1) / 100]) } }));
            if (frames.some((f) => f.t === 'notice' && f.text.includes('Room storage is full'))) {
                expect(room.act.strokes).toEqual(before); expect(frames.some((f) => f.t === 'act')).toBe(false); refused = true; break;
            }
        }
        expect(refused).toBe(true); expect(new TextEncoder().encode(JSON.stringify(engine.roomSnapshot())).byteLength).toBeLessThan(32768);
        engine.message(owner, JSON.stringify({ t: 'act', ch: '#art-friends', kind: 'clear' })); expect(room.act.strokes).toEqual([]);
        now += 1000;
        engine.message(owner, JSON.stringify({ t: 'act', ch: '#art-friends', kind: 'stroke', stroke: { id: 'fresh', color: '#009ee8', size: 8, pts: [[0.2, 0.3], [0.3, 0.4]] } }));
        expect(room.act.strokes).toHaveLength(1);
    });
    it('fails closed on oversized restored state without making registered names available', () => {
        const owner = guest('Painter', { account: 'account-owner' }); cmd(owner, 'join', ['#art-friends']); cmd(owner, 'register', [], '#art-friends');
        const saved = engine.roomSnapshot();
        saved.rooms[0].act.strokes = Array.from({ length: 100 }, (_, n) => ({ id: `large-${n}`, color: '#009ee8', size: 8, pts: Array.from({ length: 80 }, (_, i) => [i / 100, (i + 1) / 100]) }));
        boot({ roomStateBytes: 32768 }); engine.restoreRooms(saved);
        expect(engine.adminState().lock).toBe('readonly');
        const visitor = guest('Visitor'); cmd(visitor, 'join', ['#art-friends']); expect(engine._debug.channels.has('#art-friends')).toBe(false);
    });
});

describe('broadcast lifecycle', () => {
    it('continues broadcasting when a socket disappears during a buffered flush', () => {
        let gone = '';
        engine = createLobby({ now: () => now, limits: { defaultSlow: 0 }, send: (id, frame) => {
            if (id === gone) throw new Error('socket gone');
            frames.push({ recipient: id, ...frame });
        } });
        const first = guest('First'); const second = guest('Second'); gone = first; frames.length = 0;
        expect(() => engine.message(second, JSON.stringify({ t: 'say', ch: '#stalemate', text: 'Message still arrives' }))).not.toThrow();
        expect(frames.some((f) => f.recipient === second && f.t === 'line' && f.text === 'Message still arrives')).toBe(true);
    });
});
