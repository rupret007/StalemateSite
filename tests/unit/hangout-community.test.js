// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';
import { ROOM_TTL, LOG_TTL } from '../../hangout-worker/src/community-state.mjs';
let engine, now, frames, writes, seq;
const lobby = '#stalemate';
function boot(saved) {
    frames = []; writes = []; seq = 0;
    engine = createLobby({ now: () => now, send: (id, frame) => frames.push({ id, ...frame }), persist: (key, value) => writes.push([key, structuredClone(value)]), limits: { defaultSlow: 0 } });
    if (saved) engine.restoreRooms(saved);
}
function guest(nick, extra = {}) {
    const id = `user${++seq}`;
    engine.connect({ id, dev: `dev-${nick}`, iph: `ip-${nick}`, ...extra });
    engine.message(id, JSON.stringify({ t: 'hello', nick, age13: true }));
    return id;
}
const cmd = (id, name, args = [], ch = lobby) => engine.message(id, JSON.stringify({ t: 'cmd', name, args, ch }));
const room = (name = '#friends') => engine._debug.channels.get(name);
const own = () => { const a = guest('Alice', { account: 'account-a' }); cmd(a, 'join', ['#friends']); cmd(a, 'register', [], '#friends'); return a; };
beforeEach(() => { now = 1800000000000; boot(); });

describe('registered rooms', () => {
    it('keeps guest creation immediate but requires verified founder registration', () => {
        const a = guest('Alice'); cmd(a, 'join', ['#friends']); cmd(a, 'register', [], '#friends');
        expect(room().owner).toBe('');
        const b = guest('Bravo', { account: 'account-b' }); cmd(b, 'join', ['#friends']); cmd(b, 'register', [], '#friends');
        expect(room().owner).toBe('');
    });
    it('restores owner, restrictions and metadata across restart without chat, PMs or invites', () => {
        const a = own(); cmd(a, 'topic', ['Our room'], '#friends');
        engine.message(a, JSON.stringify({ t: 'say', ch: '#friends', text: 'Ephemeral words' }));
        cmd(a, 'mode', ['+k', 'secretkey'], '#friends');
        const saved = engine.roomSnapshot(); expect(JSON.stringify(saved)).not.toContain('Ephemeral words');
        boot(saved);
        const again = guest('NewName', { account: 'account-a', dev: 'different-device' });
        cmd(again, 'join', ['#friends']);
        expect(room().members.has(again)).toBe(true);
        expect(frames.filter((f) => f.t === 'join').at(-1).ch.names.find((n) => n.nick === 'NewName')).toMatchObject({ owner: true, prefix: '@' });
        expect(frames.some((f) => f.t === 'line')).toBe(false);
        expect(room().topic).toBe('Our room');
    });
    it('does not grant the old browser ownership without email sign-in', () => {
        const a = own(); engine.disconnect(a);
        const b = guest('AliceAgain', { dev: 'dev-Alice' }); cmd(b, 'join', ['#friends']);
        expect(frames.filter((f) => f.t === 'join').at(-1).ch.names.find((n) => n.nick === 'AliceAgain')).toMatchObject({ owner: false, prefix: '' });
        cmd(b, 'unregister', [], '#friends'); expect(room()).toBeDefined();
    });
    it('protects restricted rooms from the public directory', () => {
        const a = own(); cmd(a, 'mode', ['+i'], '#friends');
        const b = guest('Bravo'); cmd(b, 'list');
        expect(frames.filter((f) => f.id === b && f.t === 'list').at(-1).rooms).toEqual([]);
        cmd(a, 'list'); expect(frames.filter((f) => f.id === a && f.t === 'list').at(-1).rooms[0].mine).toBe(true);
    });
    it('keeps registration beyond empty cleanup, but expires after 90 inactive days', () => {
        const a = own(); engine.disconnect(a); now += 11 * 60000; engine.tick(); expect(room()).toBeDefined();
        now += ROOM_TTL; engine.tick(); expect(room()).toBeUndefined();
    });
    it('does not let ordinary visitors renew registration', () => {
        const a = own(); engine.disconnect(a); now += ROOM_TTL - 1000;
        const b = guest('Bravo'); cmd(b, 'join', ['#friends']); now += 1001; engine.tick();
        expect(room()).toBeUndefined();
    });
    it('requires verified co-host acceptance, and rejects reused offers', () => {
        const a = own(); const b = guest('Bravo', { account: 'account-b' }); cmd(b, 'join', ['#friends']);
        cmd(a, 'cohost', ['add', 'Bravo'], '#friends'); cmd(a, 'transfer', ['Bravo'], '#friends');
        cmd(b, 'acceptowner', [], '#friends'); expect(room().owner).toBe('account-b');
        cmd(a, 'acceptowner', [], '#friends'); expect(room().owner).toBe('account-b');
        cmd(a, 'unregister', [], '#friends'); expect(room()).toBeDefined();
    });
    it('reserves the last seat for the absent registered owner', () => {
        const a = own(); engine.disconnect(a);
        for (let n = 0; n < 8; n++) { const b = guest(`Guest${n}`); cmd(b, 'join', ['#friends']); }
        expect(room().members.size).toBe(7);
        const back = guest('BackAgain', { account: 'account-a' }); cmd(back, 'join', ['#friends']); expect(room().members.size).toBe(8);
    });
    it('fails closed on malformed room storage rather than releasing names', () => {
        engine.restoreRooms({ version: 1, rooms: [{ name: '#friends' }] });
        const a = guest('Alice'); cmd(a, 'join', ['#friends']); expect(room()).toBeUndefined();
        expect(engine.adminState().lock).toBe('readonly');
    });
    it('withholds registration success until storage commits and stops changes on failure', async () => {
        let reject;
        engine = createLobby({ now: () => now, send: (id, frame) => frames.push({ id, ...frame }), persist: (k) => k === 'rooms' ? new Promise((_, no) => { reject = no; }) : undefined });
        const a = guest('Alice', { account: 'account-a' });
        const pending = cmd(a, 'join', ['#friends']);
        expect(frames.some((f) => f.t === 'join' && f.ch.name === '#friends')).toBe(false);
        reject(new Error('disk')); await pending;
        expect(engine.adminState().lock).toBe('readonly');
        await cmd(a, 'register', [], '#friends'); expect(room().owner).toBe('');
    });
});

describe('moderation and flooding', () => {
    it('allows a MOD to review and mute, without BAND status or configuration power', async () => {
        const m = guest('Helper', { role: 'moderator', admin: true }); const a = guest('Alice');
        cmd(m, 'mute', ['Alice']); expect(engine._debug.net.mutes['dev-Alice']).toBeGreaterThan(now);
        for (const name of ['filter', 'shield', 'lobby', 'slow']) cmd(m, name, ['unlock']);
        expect(frames.filter((f) => f.id === m && f.t === 'denied')).toHaveLength(4);
        expect(frames.find((f) => f.id === m && f.t === 'welcome')).toMatchObject({ band: false, moderator: true });
        await Promise.resolve();
        expect(frames.filter((f) => f.id === m && f.t === 'admin').at(-1).state.capabilities).toMatchObject({ moderate: true, configure: false });
    });
    it('protects staff from moderator mute and indirect lobby mode changes', () => {
        const m = guest('Helper', { role: 'moderator', admin: true }); guest('Drummer', { role: 'band' });
        cmd(m, 'mute', ['Drummer']); cmd(m, 'mode', ['+S', '200']); cmd(m, 'lock');
        expect(engine._debug.net.mutes['dev-Drummer']).toBeUndefined(); expect(engine.adminState().lock).toBe('off'); expect(engine.adminState().slow).toBe(0);
    });
    it('shares command limits across tabs and restores them after restart', () => {
        const a = guest('Alice'); for (let i = 0; i < 12; i++) cmd(a, 'help');
        expect(frames.some((f) => f.t === 'rate-limit')).toBe(true);
        const saved = engine.abuseSnapshot(); boot(); engine.restoreAbuse(saved);
        const b = guest('OtherNick', { dev: 'dev-Alice' });
        expect(frames.some((f) => f.id === b && f.t === 'rate-limit')).toBe(true);
        now += 11000; engine.message(b, JSON.stringify({ t: 'hello', nick: 'OtherNick', age13: true }));
        expect(frames.some((f) => f.id === b && f.t === 'welcome')).toBe(true);
    });
    it('expires restored action metadata after thirty days', () => {
        engine.restoreLog([{ at: now - LOG_TTL - 1, action: 'old' }, { at: now - 10, action: 'recent' }]);
        expect(engine.modlog.map((e) => e.action)).toEqual(['recent']);
    });
});

describe('room lifecycle and abuse regressions', () => {
    it('keeps the first empty instant across repeated restarts', () => {
        const a = own(); cmd(a, 'unregister', [], '#friends');
        now += 11 * 60000; cmd(a, 'join', ['#temporary']);
        const first = engine.roomSnapshot(); now += 1000; boot(first);
        const emptyAt = room('#temporary').emptySince;
        now += 60000; boot(engine.roomSnapshot());
        expect(room('#temporary').emptySince).toBe(emptyAt);
        now = emptyAt + 10 * 60000 + 1; engine.tick(); expect(room('#temporary')).toBeUndefined();
    });
    it('limits ownership to three rooms and does not renew using a stolen nickname', () => {
        const a = own();
        for (const name of ['#second', '#third', '#fourth']) { now += 61 * 60000; cmd(a, 'join', [name]); cmd(a, 'register', [], name); }
        expect(room('#third').owner).toBe('account-a'); expect(room('#fourth').owner).toBe('');
        const renewed = room().renewed; engine.disconnect(a);
        const fake = guest('Alice'); cmd(fake, 'join', ['#friends']);
        expect(room().renewed).toBe(renewed);
    });
    it('expires ownership offers and allows revocation after a co-host leaves', () => {
        const a = own(); const b = guest('Bravo', { account: 'account-b' }); cmd(b, 'join', ['#friends']);
        cmd(a, 'cohost', ['add', 'Bravo'], '#friends'); cmd(a, 'transfer', ['Bravo'], '#friends');
        now += 11 * 60000; cmd(b, 'acceptowner', [], '#friends'); expect(room().owner).toBe('account-a');
        engine.disconnect(b); cmd(a, 'cohost', ['remove', 'account-b'], '#friends'); expect(room().cohosts.size).toBe(0);
    });
    it('retains drawing state but never camera activation across restart, then clears idle activity', () => {
        const a = guest('Painter', { account: 'account-a' }); cmd(a, 'join', ['#art-friends']); cmd(a, 'register', [], '#art-friends');
        engine.message(a, JSON.stringify({ t: 'act', ch: '#art-friends', kind: 'stroke', stroke: { id: 'stroke-one', color: '#009ee8', size: 8, pts: [[0.2, 0.2], [0.5, 0.5]] } }));
        engine.message(a, JSON.stringify({ t: 'cam', ch: '#art-friends', on: true, adult18: true }));
        boot(engine.roomSnapshot());
        expect(room('#art-friends').act.strokes).toHaveLength(1);
        const b = guest('PainterBack', { account: 'account-a' }); cmd(b, 'join', ['#art-friends']);
        expect(engine._debug.conns.get(b).cams.size).toBe(0);
        engine.disconnect(b); now += 11 * 60000; engine.tick(); expect(room('#art-friends').act.strokes).toEqual([]);
    });
    it('shares public and private message allowances across tabs', () => {
        const a = guest('Alice', { account: 'account-a' }); const b = guest('Bravo'); const other = guest('AnotherTab', { account: 'account-a', dev: 'other-device' }); now += 3 * 60000;
        cmd(a, 'query', ['Bravo']); cmd(b, 'accept', ['Alice']);
        for (let i = 0; i < 5; i++) engine.message(a, JSON.stringify({ t: 'say', ch: lobby, text: `public words ${i}` }));
        // Even a new device with the same verified account cannot refill the chat bucket.
        cmd(other, 'msg', ['Bravo', 'queued words']); cmd(b, 'accept', ['AnotherTab']);
        expect(frames.some((f) => f.t === 'pm' && f.text === 'queued words')).toBe(false);
        expect(frames.some((f) => f.id === other && f.t === 'rate-limit' && f.scope === 'chat')).toBe(true);
    });
    it('retains account bans across device changes', () => {
        const a = guest('Alice', { account: 'account-a' }); const mod = guest('Helper', { role: 'moderator' });
        cmd(mod, 'gban', ['Alice', 'Repeated abuse']);
        expect(engine.connect({ id: 'new', dev: 'fresh-device', iph: 'fresh-ip', account: 'account-a' })).toMatchObject({ ok: false, reason: 'banned' });
    });
});
