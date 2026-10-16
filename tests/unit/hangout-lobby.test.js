// @vitest-environment node
// Hang Out lobby engine: IRC commands, server-side permissions, filters, PMs, moderation, budget, stats.
import { describe, expect, it, beforeEach } from 'vitest';
import { createLobby, COMMANDS, LOBBY, validWebjamInvite, validWebJoin } from '../../hangout-worker/src/lobby-core.mjs';
import { checkText, checkNick, normalize } from '../../hangout-worker/src/filter.mjs';

let clock;
let L;
let inbox;
let closed;
function boot(limits = {}) {
    clock = 1_800_000_000_000;
    inbox = new Map();
    closed = [];
    L = createLobby({ now: () => clock, limits, send: (id, m) => { if (!inbox.has(id)) inbox.set(id, []); inbox.get(id).push(m); }, close: (id, code) => closed.push([id, code]) });
}
let n = 0;
function join(nick, { role = 'fan', iph = 'ip1', dev, admin } = {}) {
    const id = `c${(n += 1)}`;
    const r = L.connect({ id, dev: dev || `dev-${nick}`, iph, role, admin: admin ?? role !== 'fan' });
    if (!r.ok) return { id, refused: r };
    L.message(id, JSON.stringify({ t: 'hello', nick, age13: true }));
    return { id, nick };
}
const say = (u, text, ch = LOBBY) => L.message(u.id, JSON.stringify({ t: 'say', ch, text }));
const cmd = (u, name, args = [], ch = LOBBY) => L.message(u.id, JSON.stringify({ t: 'cmd', name, args, ch }));
const got = (u) => inbox.get(u.id) || [];
const lines = (u) => got(u).filter((m) => m.t === 'line').map((m) => m.text);
const notices = (u) => got(u).filter((m) => m.t === 'notice' || m.t === 'denied').map((m) => m.text).join('\n');
const later = (ms) => { clock += ms; };

beforeEach(() => boot());

describe('filter', () => {
    it('allows swearing (Jeff: it’s part of speech) and blocks slurs and sexual content, incl. leetspeak', () => {
        for (const ok of ['this riff is fucking shit hot', 'Turdanoid rules', 'what a bitch of a day', 'holy shit that drummer', 'damn, cock-up on the bridge', 'son of a bitch that was loud']) expect(checkText(ok).verdict, ok).toBe('ok');
        expect(checkText('send me porn').verdict).toBe('block');
        expect(checkText('you f4ggot').verdict).toBe('block');
        expect(checkText('n1gg3r').verdict).toBe('block');
    });
    it('targets abuse: insults aimed at a person are held, threats and spam are blocked', () => {
        for (const t of ['you are such a loser', 'ur so ugly', 'you\'re a fucking idiot', 'shut up you', 'you dumb bitch']) expect(checkText(t).verdict, t).toBe('hold');
        for (const t of ['kys', 'kill yourself', 'i\'ll find you', 'i know where you live', 'hope u die', 'aaaaaaaaaaaaaaaaaaaaaa']) expect(checkText(t).verdict, t).toBe('block');
        expect(checkText('you rock, that was fucking great').verdict).toBe('ok');
    });
    it('blocks personal info, socials, grooming lines and non-YouTube links', () => {
        for (const t of ['call 214-555-0199', 'me@mail.com', 'me (at) mail (dot) com', 'I live at 1234 Elm Street', 'snap me', 'add me on discord', 'how old are u', '@my_insta123', 'go to evil.ru/x', 'https://bit.ly/abc']) {
            expect(checkText(t).verdict, t).toBe('block');
        }
        expect(checkText('watch https://youtu.be/dQw4w9WgXcQ').verdict).toBe('ok');
    });
    it('runs the slur matcher on separator-stripped and spaced-out text (Karen #21)', () => {
        for (const t of ['n.i.g.g.e.r', 'n-i-g-g-e-r', 'f a g g o t', 'n_i_g_g_e_r', 'f.4.g.g.0.t', 'N I G G E R', 'hey f a g g o t']) expect(checkText(t).verdict, t).toBe('block');
    });
    it('blocks sexual phrases even when each word alone is mild swearing', () => {
        for (const t of ['suck my dick', 'send dick pics', 'show me your tits', 'nice boobs', 'wanna fuck?', 's u c k my dick', 'send me ur nudes', 'lick my balls', 'nice rack', 'can i fuck you']) expect(checkText(t).verdict, t).toBe('block');
        for (const ok of ['damn, cock-up on the bridge', 'tits up, the amp died', 'I wanna fuck shit up', 'what a dick move by the venue', 'f.u.c.k yeah', 's h i t', 'this riff is fucking shit hot']) expect(checkText(ok).verdict, ok).toBe('ok');
    });
    it('cunt is swearing, but aimed at a person it is held for a band op like other insults', () => {
        for (const ok of ['what a cunt of a day', 'that hill is a cunt of a climb haha', 'fucking cunt of a pedal broke']) expect(checkText(ok).verdict, ok).toBe('ok');
        for (const t of ['you cunt', 'you\'re a fucking cunt', 'shut up cunt', 'fuck off you cunt', 'Bravo is a cunt', 'cunts like you']) expect(checkText(t).verdict, t).toBe('hold');
    });
    it('blocks sit-on-my-face style lines; music compliments with "ass" pass, "nice ass" at a person stays blocked', () => {
        for (const t of ['sit on my face', 'come sit on my face', 'sit on ur face', 'wanna ride my face', 'facesitting', 's i t on my face', 'nice ass', 'nice ass, Bravo', 'Bravo has a nice ass', 'sexy butt']) expect(checkText(t).verdict, t).toBe('block');
        for (const ok of ['nice ass riff', 'big ass amp', 'that was a nice ass solo', 'great ass-riff dude', 'sit on my amp while I tune', 'nice ass guitar tone']) expect(checkText(ok).verdict, ok).toBe('ok');
    });
    it('the music exception for "ass" does not cover a person after the music word', () => {
        for (const t of ['nice ass guitar girl', 'nice ass bass player', 'nice ass band chick', 'nice ass guitar tone babe', 'great ass stage guy', 'big ass drum boy']) expect(checkText(t).verdict, t).not.toBe('ok');
        for (const ok of ['nice ass riff', 'big ass amp', 'nice ass guitar tone', 'nice ass riff, dude!', 'great ass-riff dude', 'nice ass solo bro']) expect(checkText(ok).verdict, ok).toBe('ok');
    });
    it('blocks spelled-out phone numbers but not count-ins or set lists', () => {
        for (const t of ['two one four five five five oh one nine nine', '2 one 4 555 oh 1 9 9', 'call me at two-one-four, five five five, zero one nine nine', 'text eight 1 seven 5 5 5 1 2 3 4']) expect(checkText(t).verdict, t).toBe('block');
        for (const ok of ['one two three four five six seven eight', 'take 5, the set is 1 2 3 4 songs', 'I saw them at 7 or 8, no 9', 'one more song!']) expect(checkText(ok).verdict, ok).toBe('ok');
    });
    it('normalises bidi overrides, zero-widths and Zalgo floods', () => {
        expect(normalize('a\u202Eb\u200Bc')).toBe('abc');
        expect(normalize('z\u0301\u0301\u0301\u0301\u0301').length).toBe(3);
        expect(normalize('x'.repeat(500)).length).toBe(300);
    });
    it('reserves band, bot and staff nicks and filters rude ones', () => {
        for (const bad of ['Jeff', 'StaleBot', 'stalemate_fan', 'admin', 'ChanServ', 'Jeff2', 'ab', '1abc', 'p0rnking', 'x<script>']) expect(checkNick(bad).ok, bad).toBe(false);
        expect(checkNick('Sk8rKid').ok).toBe(true);
    });
});

describe('getting in is one tap', () => {
    it('nick + 13+ joins #stalemate with a StaleBot welcome and the room list', () => {
        const a = join('Sk8rKid');
        expect(got(a).some((m) => m.t === 'join' && m.ch.name === LOBBY)).toBe(true);
        expect(notices(a)).toMatch(/welcome to #stalemate, Sk8rKid/);
        expect(got(a).some((m) => m.t === 'list')).toBe(true);
    });
    it('refuses without the 13+ tick and refuses taken nicks', () => {
        const id = 'x1';
        L.connect({ id, dev: 'd', iph: 'i' });
        L.message(id, JSON.stringify({ t: 'hello', nick: 'Kiddo' }));
        expect(inbox.get(id).some((m) => m.t === 'welcome')).toBe(false);
        join('Taken');
        const b = { id: 'x2' };
        L.connect({ id: 'x2', dev: 'd2', iph: 'i' });
        L.message('x2', JSON.stringify({ t: 'hello', nick: 'taken', age13: true }));
        expect(got(b).some((m) => m.t === 'nick-error')).toBe(true);
    });
});

describe('classic IRC commands', () => {
    it('/me /slap /nick /topic /names /whois /away /list /help', () => {
        const a = join('Alpha');
        const b = join('Bravo');
        cmd(a, 'me', ['moshes']);
        expect(got(b).find((m) => m.t === 'line' && m.me).text).toBe('moshes');
        later(4000);
        cmd(a, 'slap', ['Bravo']);
        expect(lines(b)).toContain('slaps Bravo around a bit with a large trout');
        later(61000);
        cmd(a, 'nick', ['Alfa']);
        expect(got(b).some((m) => m.t === 'event' && /Alpha is now known as Alfa/.test(m.text))).toBe(true);
        cmd(a, 'nick', ['Alfa2']);
        expect(notices(a)).toMatch(/One nick change per minute/);
        cmd(b, 'whois', ['Alfa']);
        cmd(b, 'away', ['getting', 'tacos']);
        cmd(b, 'names');
        cmd(b, 'topic');
        cmd(b, 'help');
        expect(notices(b)).toMatch(/Alfa · on #stalemate/);
        expect(notices(b)).toMatch(/away: getting tacos/);
        expect(notices(b)).toMatch(/#stalemate: .*Alfa/);
        expect(notices(b)).toMatch(/\/slap/);
        cmd(b, 'list');
        expect(got(b).some((m) => m.t === 'list' && m.show)).toBe(true);
    });
    it('/join creates an open room with the founder as @ (one tap = cmd join)', () => {
        const a = join('Alpha');
        const b = join('Bravo');
        cmd(a, 'join', ['#bobross-friday']);
        const room = L._debug.channels.get('#bobross-friday');
        expect(room.kind).toBe('bobross');
        expect(room.ops.has('dev-Alpha')).toBe(true);
        expect(got(b).some((m) => m.t === 'list' && m.rooms.some((r) => r.name === '#bobross-friday'))).toBe(true);
        cmd(b, 'join', ['#bobross-friday']);
        expect(room.members.size).toBe(2);
        cmd(b, 'part', ['#bobross-friday']);
        expect(room.members.size).toBe(1);
        cmd(b, 'part');
        expect(notices(b)).toMatch(/can’t part #stalemate/);
    });
    it('/ignore hides someone locally; /quit leaves', () => {
        const a = join('Alpha');
        const b = join('Bravo');
        cmd(b, 'ignore', ['Alpha']);
        say(a, 'hello there');
        expect(lines(b)).not.toContain('hello there');
        cmd(a, 'quit', ['bye']);
        expect(closed.some(([id]) => id === a.id)).toBe(true);
    });
});

describe('permissions are enforced on the server (forged commands)', () => {
    const chanop = Object.entries(COMMANDS).filter(([, s]) => s === 'chanop').map(([k]) => k);
    const band = Object.entries(COMMANDS).filter(([, s]) => s === 'band').map(([k]) => k);
    it('a plain fan is denied every op and band command, and each attempt is logged', () => {
        const fan = join('Fan');
        join('Victim');
        for (const name of [...chanop, ...band]) cmd(fan, name, ['Victim', 'x']);
        const denied = got(fan).filter((m) => m.t === 'denied').map((m) => m.cmd);
        expect(denied.sort()).toEqual([...chanop, ...band].sort());
        expect(L.modlog.filter((e) => e.action === 'denied').length).toBe(chanop.length + band.length);
        expect(closed.length).toBe(0);
    });
    it('typed /kick and raw {t:"cmd"} frames are treated the same', () => {
        const fan = join('Fan');
        const v = join('Victim');
        say(fan, '/kick Victim lol');
        L.message(fan.id, JSON.stringify({ t: 'cmd', name: 'mode', args: ['+o', 'Fan'], ch: LOBBY }));
        expect(got(fan).filter((m) => m.t === 'denied').length).toBe(2);
        expect(L._debug.conns.has(v.id)).toBe(true);
    });
    it('a room founder is @ only in their own room, never in the lobby or another room', () => {
        const a = join('Alpha');
        const b = join('Bravo');
        const c = join('Charlie');
        cmd(a, 'join', ['#watch-a']);
        later(11 * 60 * 1000);
        cmd(b, 'join', ['#watch-b'], LOBBY);
        cmd(c, 'join', ['#watch-b']);
        cmd(a, 'kick', ['Charlie'], '#watch-b');
        cmd(a, 'kick', ['Charlie'], LOBBY);
        expect(got(a).filter((m) => m.t === 'denied').length).toBe(2);
        cmd(b, 'kick', ['Charlie', 'bye'], '#watch-b');
        expect(L._debug.channels.get('#watch-b').members.has(c.id)).toBe(false);
    });
    it('frames with spoofed role fields or bad JSON do not grant anything', () => {
        const fan = join('Fan');
        L.message(fan.id, JSON.stringify({ t: 'cmd', name: 'shield', args: [], ch: LOBBY, role: 'owner', band: true }));
        expect(L._debug.net.shield).toBe(false);
        L.message(fan.id, '{nope');
        expect(closed.at(-1)).toEqual([fan.id, 4400]);
    });
    it('a room founder ban covers device, nick AND IP hash, so a private window or new nick cannot dodge it', () => {
        const a = join('Alpha', { iph: 'home' });
        const t = join('Troll', { iph: 'trollnet' });
        cmd(a, 'join', ['#art-ban']);
        cmd(t, 'join', ['#art-ban']);
        const room = L._debug.channels.get('#art-ban');
        cmd(a, 'ban', ['Troll', 'rude'], '#art-ban');
        expect(room.members.has(t.id)).toBe(false);
        expect(room.bans.map((b) => b.mask)).toEqual(expect.arrayContaining(['dev:dev-Troll', 'nick:troll', 'iph:trollnet']));
        const dodge = join('FreshFace', { iph: 'trollnet', dev: 'private-window' });
        cmd(dodge, 'join', ['#art-ban']);
        expect(room.members.has(dodge.id)).toBe(false);
        expect(notices(dodge)).toMatch(/banned from #art-ban/);
        const other = join('Neighbor', { iph: 'elsewhere' });
        cmd(other, 'join', ['#art-ban']);
        expect(room.members.has(other.id)).toBe(true);
        later(24 * 60 * 60 * 1000 + 1);
        const back = join('LaterFace', { iph: 'trollnet', dev: 'another-window' });
        cmd(back, 'join', ['#art-ban']);
        expect(room.members.has(back.id)).toBe(true); // the IP part expires (shared IPs), the device ban does not
        expect(L._debug.net.bans.some((b) => b.mask === 'iph:trollnet')).toBe(false); // room ban stays room-only
    });
    it('founders can op, voice, set modes, lock and close only their room', () => {
        const a = join('Alpha');
        const b = join('Bravo');
        cmd(a, 'join', ['#art-sketch']);
        cmd(b, 'join', ['#art-sketch']);
        const room = L._debug.channels.get('#art-sketch');
        cmd(a, 'mode', ['+m'], '#art-sketch');
        say(b, 'can I talk', '#art-sketch');
        expect(notices(b)).toMatch(/\+m/);
        cmd(a, 'voice', ['Bravo'], '#art-sketch');
        later(4000);
        say(b, 'now I can', '#art-sketch');
        expect(lines(a)).toContain('now I can');
        cmd(a, 'op', ['Bravo'], '#art-sketch');
        expect(room.ops.has('dev-Bravo')).toBe(true);
        cmd(a, 'mode', ['+k', 'secret1'], '#art-sketch');
        cmd(a, 'mode', ['+l', '99'], '#art-sketch');
        expect(room.modes.l).toBe(8);
        cmd(a, 'topic', ['happy', 'little', 'trees'], '#art-sketch');
        expect(room.topic).toBe('happy little trees');
        cmd(a, 'lock', [], '#art-sketch');
        expect(room.modes.locked).toBe(true);
        cmd(a, 'close', [], '#art-sketch');
        expect(L._debug.channels.has('#art-sketch')).toBe(false);
        expect(got(b).some((m) => m.t === 'closed')).toBe(true);
    });
    it('+i rooms need /invite and +k rooms need the key', () => {
        const a = join('Alpha');
        const b = join('Bravo');
        cmd(a, 'join', ['#watch-x']);
        cmd(a, 'mode', ['+i'], '#watch-x');
        cmd(b, 'join', ['#watch-x']);
        expect(notices(b)).toMatch(/invite-only/);
        cmd(a, 'invite', ['Bravo'], '#watch-x');
        expect(got(b).some((m) => m.t === 'invite')).toBe(true);
        cmd(b, 'join', ['#watch-x']);
        expect(L._debug.channels.get('#watch-x').members.has(b.id)).toBe(true);
    });
});

describe('PMs are accept-first, filtered, blockable, switchable and need lobby time', () => {
    it('full flow', () => {
        const a = join('Alpha');
        const b = join('Bravo');
        cmd(a, 'msg', ['Bravo', 'hey']);
        expect(notices(a)).toMatch(/Hang in the lobby/);
        later(2 * 60 * 1000 + 1);
        cmd(a, 'msg', ['Bravo', 'hey', 'great', 'set']);
        expect(got(b).some((m) => m.t === 'pm-request' && m.from === 'Alpha')).toBe(true);
        expect(got(b).some((m) => m.t === 'pm')).toBe(false); // nothing delivered before accept
        cmd(b, 'accept', ['Alpha']);
        expect(got(b).find((m) => m.t === 'pm').text).toBe('hey great set');
        cmd(a, 'msg', ['Bravo', 'text', 'me', '214-555-0199']);
        expect(got(b).filter((m) => m.t === 'pm').length).toBe(1);
        expect(notices(a)).toMatch(/even in PMs/);
        cmd(b, 'block', ['Alpha']);
        cmd(a, 'msg', ['Bravo', 'yo']);
        expect(got(b).filter((m) => m.t === 'pm').length).toBe(1);
    });
    it('/pm off refuses requests; decline clears', () => {
        const a = join('Alpha');
        const b = join('Bravo');
        later(3 * 60 * 1000);
        cmd(b, 'pm', ['off']);
        cmd(a, 'query', ['Bravo']);
        expect(notices(a)).toMatch(/isn't taking PMs/);
        cmd(b, 'pm', ['on']);
        cmd(a, 'query', ['Bravo']);
        cmd(b, 'decline', ['Alpha']);
        cmd(a, 'msg', ['Bravo', 'pls']);
        expect(got(b).filter((m) => m.t === 'pm-request').length).toBe(2);
        expect(got(b).some((m) => m.t === 'pm')).toBe(false);
    });
    it('caps pending requests per sender', () => {
        const a = join('Alpha');
        for (const x of ['Bb1', 'Bb2', 'Bb3', 'Bb4', 'Bb5', 'Bb6']) join(x);
        later(3 * 60 * 1000);
        for (const x of ['Bb1', 'Bb2', 'Bb3', 'Bb4', 'Bb5', 'Bb6']) cmd(a, 'query', [x]);
        expect(notices(a)).toMatch(/Too many PM requests/);
    });
});

describe('abuse caps', () => {
    it('repeat spam is refused', () => {
        const a = join('Alpha');
        say(a, 'buy my mixtape');
        later(4000);
        say(a, 'buy my mixtape');
        expect(lines(a).filter((t) => t === 'buy my mixtape').length).toBe(1);
        expect(notices(a)).toMatch(/Heard you the first time/);
    });
    it('flood: token bucket + lobby slow mode', () => {
        const a = join('Alpha');
        for (let i = 0; i < 10; i += 1) say(a, `spam ${i}`);
        expect(lines(a).length).toBe(1);
        expect(notices(a)).toMatch(/Slow mode/);
    });
    it('oversized frames and frame caps close the socket', () => {
        const a = join('Alpha');
        L.message(a.id, 'x'.repeat(5000));
        expect(closed.at(-1)).toEqual([a.id, 4400]);
    });
    it('the lobby caps at 150 fans (fail closed)', () => {
        boot({ lobbyMax: 3 });
        join('Aaa'); join('Bbb'); join('Ccc');
        expect(join('Ddd').refused.status).toBe(429);
        expect(join('Band1', { role: 'band' }).refused).toBeUndefined();
    });
    it('room creation is rate-limited per device and per IP hash', () => {
        const a = join('Alpha', { iph: 'shared' });
        cmd(a, 'join', ['#watch-1']);
        cmd(a, 'join', ['#watch-2']);
        expect(notices(a)).toMatch(/One new room per 10 minutes/);
        const b = join('Bravo', { iph: 'shared' });
        const c = join('Charlie', { iph: 'shared' });
        const d = join('Delta', { iph: 'shared' });
        cmd(b, 'join', ['#watch-3']); cmd(c, 'join', ['#watch-4']); cmd(d, 'join', ['#watch-5']);
        expect(notices(d)).toMatch(/Too many new rooms/);
    });
    it('budget guard: read-only at 85%, closed at 95% of the daily request share', () => {
        boot({ requestBudget: 100 });
        const a = join('Alpha');
        L.spend(80);
        later(4000);
        say(a, 'still fine');
        expect(lines(a)).toContain('still fine');
        L.spend(5);
        later(4000);
        say(a, 'now read only');
        expect(notices(a)).toMatch(/read-only/);
        L.spend(10);
        expect(join('Bravo').refused.reason).toBe('budget');
    });
});

describe('band moderation', () => {
    it('kick has a 10 minute cooldown; ban covers device AND IP hash (ban-dodge test)', () => {
        const band = join('Drummer', { role: 'band' });
        const t = join('Troll', { iph: 'trollnet' });
        cmd(band, 'kick', ['Troll', 'chill']);
        expect(closed.some(([id]) => id === t.id)).toBe(true);
        expect(join('Troll', { iph: 'trollnet' }).refused.reason).toBe('kicked');
        later(11 * 60 * 1000);
        const t2 = join('Troll', { iph: 'trollnet' });
        cmd(band, 'ban', ['Troll']);
        expect(notices(band)).toMatch(/needs a reason/);
        cmd(band, 'ban', ['Troll', 'slurs']);
        expect(closed.some(([id]) => id === t2.id)).toBe(true);
        expect(join('NewFace', { iph: 'trollnet', dev: 'brand-new-device' }).refused.reason).toBe('banned');
        expect(join('Troll', { iph: 'other', dev: 'dev-Troll' }).refused.reason).toBe('banned');
        later(25 * 60 * 60 * 1000);
        L.tick();
        expect(join('NewFace2', { iph: 'trollnet', dev: 'fresh2' }).refused).toBeUndefined();
        cmd(band, 'unban', ['Troll']);
        expect(L.modlog.map((e) => e.action)).toEqual(expect.arrayContaining(['kick', 'ban', 'unban']));
    });
    it('mute, purge, delete, shield, lobby lock and camoff', () => {
        const band = join('Drummer', { role: 'band' });
        const f = join('Fan');
        say(f, 'first line');
        cmd(band, 'mute', ['Fan', '5m']);
        later(4000);
        say(f, 'muted line');
        expect(notices(f)).toMatch(/muted/);
        cmd(band, 'purge', ['Fan']);
        expect(got(f).some((m) => m.t === 'delete')).toBe(true);
        cmd(band, 'shield');
        expect(L._debug.net.shield).toBe(true);
        cmd(band, 'shieldoff');
        cmd(band, 'lobby', ['readonly']);
        expect(got(f).some((m) => m.t === 'net' && m.lock === 'readonly')).toBe(true);
        cmd(band, 'lobby', ['lock']);
        expect(closed.some(([id]) => id === f.id)).toBe(true);
        expect(join('Late').refused.reason).toBe('locked');
    });
    it('hold tier waits for band approval; filter lists are editable', () => {
        const band = join('Drummer', { role: 'band', admin: true });
        const f = join('Fan');
        say(f, 'you are such a loser');
        expect(lines(band)).not.toContain('you are such a loser');
        const held = [...L._debug.held.keys()][0];
        cmd(band, 'approve', [held]);
        expect(lines(band)).toContain('you are such a loser');
        cmd(band, 'filter', ['block', 'nickelback']);
        later(4000);
        say(f, 'i love nickelback');
        expect(lines(band)).not.toContain('i love nickelback');
    });
    it('band messages carry the BAND flag and ops prefix; fans cannot fake it', () => {
        const band = join('Drummer', { role: 'band' });
        const f = join('Fan');
        say(band, 'soundcheck');
        const l = got(f).find((m) => m.t === 'line' && m.text === 'soundcheck');
        expect(l.band).toBe(true);
        expect(l.prefix).toBe('@');
        L.message(f.id, JSON.stringify({ t: 'say', ch: LOBBY, text: 'i am band', band: true, prefix: '@' }));
        const fl = got(band).find((m) => m.t === 'line' && m.text === 'i am band');
        expect(fl.band).toBe(false);
        expect(fl.prefix).toBe('');
    });
    it('mod log is append-only (no command removes entries)', () => {
        const band = join('Drummer', { role: 'band' });
        join('Fan');
        cmd(band, 'kick', ['Fan', 'x']);
        const before = L.modlog.length;
        for (const name of Object.keys(COMMANDS)) cmd(band, name, ['log', 'x']);
        expect(L.modlog.length).toBeGreaterThanOrEqual(before);
        expect(L.modlog[0].action).toBe('kick');
    });
});

describe('reports', () => {
    it('auto-hides at 3 distinct devices; same device or same IP hash counts once', () => {
        const bad = join('Bad');
        say(bad, 'you all stink');
        const id = got(bad).find((m) => m.t === 'line').id;
        const r1 = join('Rep1', { iph: 'a' });
        const r1b = join('Rep1b', { iph: 'a' });
        L.message(r1.id, JSON.stringify({ t: 'report', id }));
        L.message(r1.id, JSON.stringify({ t: 'report', id }));
        L.message(r1b.id, JSON.stringify({ t: 'report', id }));
        expect(L._debug.reports.get(id).devs.size).toBe(1);
        L.message(join('Rep2', { iph: 'b' }).id, JSON.stringify({ t: 'report', id }));
        expect(L._debug.reports.get(id).hidden).toBe(false);
        L.message(join('Rep3', { iph: 'c' }).id, JSON.stringify({ t: 'report', id }));
        expect(L._debug.reports.get(id).hidden).toBe(true);
        expect(got(r1).some((m) => m.t === 'delete' && m.ids.includes(id))).toBe(true);
        L.message(r1.id, JSON.stringify({ t: 'report', id: 'm-made-up' }));
        expect(L._debug.reports.has('m-made-up')).toBe(false);
        expect(L.adminState().stats.reports.autoHidden).toBe(1);
    });
});

describe('cameras: allowed in open rooms, off by default, 18+ gate', () => {
    it('gate + host camera-off + shield', () => {
        const a = join('Alpha');
        const b = join('Bravo');
        cmd(a, 'join', ['#art-cams']);
        cmd(b, 'join', ['#art-cams']);
        const cam = (u, on, adult18) => L.message(u.id, JSON.stringify({ t: 'cam', ch: '#art-cams', on, adult18 }));
        cam(b, true, false);
        expect(got(b).some((m) => m.t === 'cam-gate')).toBe(true);
        cam(b, true, true);
        expect(got(b).some((m) => m.t === 'cam' && m.on)).toBe(true);
        cmd(a, 'mode', ['-C'], '#art-cams');
        expect(got(b).some((m) => m.t === 'cam' && m.on === false)).toBe(true);
        L.message(b.id, JSON.stringify({ t: 'cam', ch: LOBBY, on: true, adult18: true }));
        expect(notices(b)).toMatch(/No cameras in #stalemate/);
    });
});

describe('auto-lockdown when no band op for 24h', () => {
    it('raises the shield automatically and tells the next band op', () => {
        join('Fan');
        later(24 * 60 * 60 * 1000 + 1);
        L.tick();
        expect(L._debug.net.shield).toBe(true);
        expect(L._debug.net.shieldAuto).toBe(true);
        const band = join('Drummer', { role: 'band' });
        expect(notices(band)).toMatch(/Auto-lockdown is on/);
    });
    it('already-open PMs stop for fans after auto-lockdown; band PMs still go through', () => {
        const a = join('Alpha');
        const b = join('Bravo');
        later(2 * 60 * 1000 + 1);
        cmd(a, 'msg', ['Bravo', 'hey']);
        cmd(b, 'accept', ['Alpha']);
        cmd(a, 'msg', ['Bravo', 'still', 'open']);
        expect(got(b).filter((m) => m.t === 'pm').map((m) => m.text)).toContain('still open');
        const band = join('Drummer', { role: 'band' });
        L.disconnect(band.id);
        later(25 * 60 * 60 * 1000);
        L.tick();
        expect(L._debug.net.lock).toBe('readonly');
        inbox.clear();
        cmd(a, 'msg', ['Bravo', 'after', 'lock']);
        cmd(a, 'query', ['Bravo', 'after', 'lock']);
        expect(got(b).some((m) => m.t === 'pm')).toBe(false);
        expect(notices(a)).toMatch(/read-only/);
        const band2 = join('Singer', { role: 'band' });
        cmd(band2, 'msg', ['Bravo', 'band', 'here']);
        expect(got(b).some((m) => m.t === 'pm-request' && m.from === 'Singer' && m.band)).toBe(true);
    });
    it('fails closed on malformed bans and budget in storage', () => {
        const fanTalks = () => { const f = join('Fan'); const p = join('Pal'); say(f, 'hi'); return lines(p).includes('hi'); };
        for (const bans of ['nope', [{ mask: 42 }], [null], [{ mask: 'dev:x', until: 'later' }], [{ mask: 'weird:x' }]]) {
            boot();
            L.restore({ lock: 'off', bans, budget: { day: '', requests: 0 } });
            expect(L._debug.net.lock, JSON.stringify(bans)).toBe('readonly');
            expect(Array.isArray(L._debug.net.bans)).toBe(true);
            expect(L._debug.net.bans.every((b) => typeof b.mask === 'string')).toBe(true);
            expect(fanTalks()).toBe(false);
        }
        boot();
        L.restore({ lock: 'off', bans: [{ mask: 'dev:dev-Troll', reason: 'x', by: 'Drummer', at: 1 }, { mask: 'oops' }] });
        expect(L._debug.net.bans.map((b) => b.mask)).toEqual(['dev:dev-Troll']); // good bans survive
        expect(join('Troll').refused.reason).toBe('banned');
        for (const budget of ['x', null, { day: 5, requests: 0 }, { day: '', requests: -1 }, { day: '', requests: 'lots' }, { day: '' }]) {
            boot();
            L.restore({ lock: 'off', bans: [], budget });
            expect(L._debug.net.lock, JSON.stringify(budget)).toBe('readonly');
            expect(L.budgetLevel()).toBe('closed');
            expect(join('Fan').refused.reason).toBe('budget');
            expect(join('Drummer', { role: 'band' }).refused).toBeUndefined();
        }
        boot();
        L.restore({ lock: 'off', bans: [], budget: { day: '', requests: 3 } });
        expect(L._debug.net.lock).toBe('off'); // well-formed state is respected
        expect(L.budgetLevel()).toBe('ok');
    });
    it('fails closed: empty or wiped storage restores read-only until a band op unlocks', () => {
        for (const wiped of [{}, undefined, { bans: [] }, { lock: 'bogus' }]) {
            boot();
            L.restore(wiped);
            expect(L._debug.net.lock).toBe('readonly');
            const fan = join('Fan');
            const pal = join('Pal');
            say(fan, 'hello?');
            expect(lines(pal)).toEqual([]);
            const band = join('Drummer', { role: 'band' });
            expect(notices(band)).toMatch(/fans can read but not talk/);
            cmd(band, 'lobby', ['unlock']);
            later(4000);
            say(fan, 'hello now');
            expect(lines(pal)).toContain('hello now');
        }
        boot();
        L.restore({ lock: 'off' });
        expect(L._debug.net.lock).toBe('off'); // a real saved state is respected
    });
    it('is a true lock: fans go read-only in the lobby, rooms and PMs; band can still talk and unlock', () => {
        const fan = join('Fan');
        const pal = join('Pal');
        cmd(fan, 'join', ['#hangs']);
        cmd(pal, 'join', ['#hangs']);
        later(23 * 60 * 60 * 1000);
        L.tick();
        expect(L._debug.net.lock).toBe('off');
        later(60 * 60 * 1000 + 1);
        L.tick();
        expect(L._debug.net.lock).toBe('readonly');
        expect(L._debug.net.lockAuto).toBe(true);
        expect(L.adminState().lockAuto).toBe(true);
        expect(got(fan).some((m) => m.t === 'net' && m.lock === 'readonly')).toBe(true);
        inbox.clear();
        say(fan, 'anyone here?');
        say(fan, 'room chat', '#hangs');
        expect(lines(pal)).toEqual([]);
        expect(notices(fan)).toMatch(/read-only/);
        L.message(fan.id, JSON.stringify({ t: 'cmd', name: 'msg', args: ['Pal', 'psst'], ch: LOBBY }));
        expect(got(pal).some((m) => m.t === 'pm-request' || m.t === 'pm')).toBe(false);
        expect(L.modlog.map((e) => e.action)).toContain('auto-lockdown');
        const snap = L.snapshot();
        expect(snap.lock).toBe('readonly');
        expect(snap.lockAuto).toBe(true);
        const band = join('Drummer', { role: 'band' });
        expect(notices(band)).toMatch(/fans can read but not talk/);
        say(band, 'we are back');
        expect(lines(fan).some((t) => /we are back/.test(t))).toBe(true);
        expect(L._debug.net.lock).toBe('readonly'); // a band op arriving does not silently reopen it
        cmd(band, 'lobby', ['unlock']);
        expect(L._debug.net.lock).toBe('off');
        expect(L._debug.net.lockAuto).toBe(false);
        inbox.clear();
        say(fan, 'yay');
        expect(lines(pal).some((t) => /yay/.test(t))).toBe(true);
    });
});

describe('jam rooms hand off to WebJam', () => {
    it('jam rooms are +i, accept only a webjam:// invite, and keep the Web Join hook off by default', () => {
        const a = join('Alpha');
        cmd(a, 'join', ['#jam-garage']);
        const room = L._debug.channels.get('#jam-garage');
        expect(room.kind).toBe('jam');
        expect(room.modes.i).toBe(true);
        expect(notices(a)).toMatch(/Ethernet/);
        cmd(a, 'jamlink', ['https://evil.example/x'], '#jam-garage');
        expect(room.jam.desktop).toBe('');
        cmd(a, 'jamlink', ['webjam://join?v=1#k=abcdef0123'], '#jam-garage');
        expect(room.jam.desktop).toBe('webjam://join?v=1#k=abcdef0123');
        cmd(a, 'jamlink', ['web', 'https://jam.example/join#x'], '#jam-garage');
        expect(room.jam.web).toBe('');
        const fan = join('Fan');
        cmd(fan, 'jamlink', ['webjam://join?v=1#k=hijack999'], '#jam-garage');
        expect(room.jam.desktop).toBe('webjam://join?v=1#k=abcdef0123');
        expect(validWebjamInvite('webjam://x" onclick=1')).toBe('');
        expect(validWebJoin('https://jam.example/j#x', ['https://jam.example'])).toBe('https://jam.example/j#x');
        expect(validWebJoin('javascript:alert(1)#x', ['https://jam.example'])).toBe('');
    });
});

describe('stats are aggregate only', () => {
    it('counts joins, room kinds, busiest rooms and moderation without nicks or devices', () => {
        const a = join('Alpha');
        const band = join('Drummer', { role: 'band' });
        cmd(a, 'join', ['#bobross-x']);
        say(a, 'send nudes');
        cmd(band, 'kick', ['Alpha', 'x']);
        const s = L.adminState().stats;
        expect(Object.values(s.days)[0].joins).toBe(2);
        expect(s.kinds.bobross).toBe(1);
        expect(s.mod['filter:personal-info']).toBe(1);
        expect(s.mod.kick).toBe(1);
        const text = JSON.stringify(s);
        expect(text).not.toMatch(/Alpha|dev-|ip1/);
    });
});
