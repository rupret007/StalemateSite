// @vitest-environment node
// Hang Out lobby engine: IRC commands, server-side permissions, filters, PMs, moderation, budget, stats.
import { describe, expect, it, beforeEach } from 'vitest';
import { createLobby, COMMANDS, LOBBY, validWebjamInvite, validWebJoin } from '../../hangout-worker/src/lobby-core.mjs';
import { discordCallLink, dropFour, fourFinished, openFour } from '../../r/45662413410ed051/lobby/game-night.mjs';
import { checkText, checkNick, normalize } from '../../hangout-worker/src/filter.mjs';

let clock;
let L;
let inbox;
let closed;
function boot(limits = {}, gameNight = false, directMusicInvites = false) {
    clock = 1_800_000_000_000;
    inbox = new Map();
    closed = [];
    L = createLobby({ gameNight, directMusicInvites, now: () => clock, limits, send: (id, m) => { if (!inbox.has(id)) inbox.set(id, []); inbox.get(id).push(m); }, close: (id, code) => closed.push([id, code]) });
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
// Explicit nickname-intent fixtures only; generic/selected/malformed commands stay separate.
const namedCmd = (u, name, args = [], ch = LOBBY) => L.message(u.id, JSON.stringify({ t: 'cmd', name, args, ch, personNamed: true }));
const got = (u) => inbox.get(u.id) || [];

it('tracks a room invitation only between the original host and guest, and expires it without granting access', () => {
    boot();
    const host = join('InviteHost'), guest = join('InviteGuest'), other = join('OtherGuest');
    const ch = '#jam-garage';
    const send = (user, frame) => L.message(user.id, JSON.stringify(frame));
    cmd(host, 'join', [ch]);
    const roomInstance = got(host).find(m => m.t === 'join' && m.ch.name === ch).ch.keepRef;
    function offer(request) {
        send(host, { t: 'room-invite-request', request, ch, roomInstance, peer: guest.id });
        expect(got(host).at(-1)).toMatchObject({ t: 'room-invite-result', request, status: 'sent' });
        expect(got(guest).at(-1)).toMatchObject({ t: 'invite', request, ch, roomInstance });
        expect(got(other).some(m => m.request === request)).toBe(false);
    }
    const expired = 'a'.repeat(32);
    offer(expired);
    send(other, { t: 'room-invite-answer', request: expired, accept: true });
    expect(got(host).at(-1)).toMatchObject({ status: 'sent' });
    clock += 120_000;
    L.tick();
    expect(got(host)).toContainEqual({ t: 'room-invite-result', request: expired, status: 'expired' });
    expect(got(guest)).toContainEqual({ t: 'room-invite-ended', request: expired, status: 'expired' });
    cmd(guest, 'join', [ch]);
    expect(got(guest).some(m => m.t === 'join' && m.ch.name === ch)).toBe(false);
    const accepted = 'b'.repeat(32);
    offer(accepted);
    send(guest, { t: 'room-invite-answer', request: accepted, accept: true });
    expect(got(guest).some(m => m.t === 'join' && m.ch.name === ch)).toBe(true);
    expect(got(host)).toContainEqual({ t: 'room-invite-result', request: accepted, status: 'accepted' });
    L.disconnect(guest.id);
    const otherDevice = join(guest.nick, { dev: 'other-device' });
    cmd(otherDevice, 'join', [ch]);
    expect(got(otherDevice).some(m => m.t === 'join' && m.ch.name === ch)).toBe(false);
    L.disconnect(otherDevice.id);
    const returning = join(guest.nick);
    cmd(returning, 'join', [ch]);
    expect(got(returning).some(m => m.t === 'join' && m.ch.name === ch)).toBe(true);
    cmd(returning, 'part', [], ch);
    cmd(returning, 'join', [ch]);
    expect(got(returning).filter(m => m.t === 'join' && m.ch.name === ch)).toHaveLength(1);
});

it('lets a host send a fresh room invitation at the deadline without waiting for maintenance', () => {
    boot();
    const host = join('InviteHost'), guest = join('InviteGuest');
    const room = '#jam-garage';
    cmd(host, 'join', [room]);
    const roomInstance = got(host).find(m => m.t === 'join' && m.ch.name === room).ch.keepRef;
    const first = 'a'.repeat(32), fresh = 'b'.repeat(32);
    const invite = request => L.message(host.id, JSON.stringify({
        t: 'room-invite-request', request, ch: room, roomInstance, peer: guest.id,
    }));
    invite(first);
    expect(got(host).at(-1)).toMatchObject({ request: first, status: 'sent' });
    clock = got(host).at(-1).until - 1;
    invite(fresh);
    expect(got(host).at(-1)).toMatchObject({ request: fresh, status: 'unavailable' });
    clock += 1;
    invite(fresh);
    expect(got(host).slice(-2)).toEqual([
        { t: 'room-invite-result', request: first, status: 'expired' },
        expect.objectContaining({ request: fresh, status: 'sent' }),
    ]);
    expect(got(guest).at(-1)).toMatchObject({ t: 'invite', request: fresh });
});

it('lets the same live guest accept a pending room invitation after engine recovery', () => {
    boot();
    const host = join('InviteHost'), guest = join('InviteGuest');
    const room = '#jam-garage', request = 'c'.repeat(32);
    cmd(host, 'join', [room]);
    const roomInstance = got(host).find(m => m.t === 'join' && m.ch.name === room).ch.keepRef;
    L.message(host.id, JSON.stringify({ t: 'room-invite-request', request, ch: room, roomInstance, peer: guest.id }));
    expect(got(host).at(-1)).toMatchObject({ status: 'sent' });
    const sessions = structuredClone(L.sessionSnapshot());
    const rooms = structuredClone(L.roomSnapshot());
    const net = structuredClone(L.snapshot());
    const live = sessions.connections.map(({ id, dev, iph, account, role, admin }) => ({ id, dev, iph, account, role, admin }));

    boot();
    L.restore(net);
    L.restoreRooms(rooms);
    expect(L.restoreSessions(sessions, live)).toEqual({ resumed: [host.id, guest.id], rejected: [] });
    L.message(guest.id, JSON.stringify({ t: 'room-invite-answer', request, accept: true }));
    expect(got(guest).some(m => m.t === 'join' && m.ch.name === room)).toBe(true);
    expect(got(host)).toContainEqual({ t: 'room-invite-result', request, status: 'accepted' });
});

const lines = (u) => got(u).filter((m) => m.t === 'line').map((m) => m.text);
const notices = (u) => got(u).filter((m) => m.t === 'notice' || m.t === 'denied').map((m) => m.text).join('\n');
const later = (ms) => { clock += ms; };

describe('direct Jam music invitations', () => {
    const room = '#jam-practice';
    const origin = 'https://music.example.test';
    const send = (user, frame) => L.message(user.id, JSON.stringify(frame));
    let host, guest, peer, invite, roomInstance;
    beforeEach(() => {
        boot({ webJoinOrigins: [origin] }, false, true);
        host = join('GuitarHost');
        guest = join('DrumGuest');
        peer = join('OtherBandmate');
        cmd(host, 'join', [room]);
        roomInstance = got(host).find(m => m.t === 'join' && m.ch.name === room).ch.keepRef;
        invite = `${origin}/join/#k=${'A'.repeat(43)}&s=${'0'.repeat(64)}&g=1&e=${clock / 1000 + 60}`;
    });
    function offer(sender = host, overrides = {}) {
        send(sender, { t: 'music-invite-offer', request: 'd'.repeat(32), ch: room, roomInstance, peer: guest.id, href: invite, ...overrides });
        return got(guest).filter(m => m.t === 'music-invite').at(-1);
    }
    function accept(user, received, overrides = {}) {
        send(user, { t: 'music-invite-accept', id: received.id, ch: room, roomInstance, ...overrides });
    }
    const delivered = user => got(user).filter(m => m.t === 'music-invite-accepted');
    it('sends only an offer to the chosen connection and delivers audio only once after room admission', () => {
        const pending = offer();
        expect(pending).toMatchObject({ ch: room, roomInstance, by: host.nick });
        expect(got(host).at(-1)).toEqual({ t: 'music-invite-result', request: 'd'.repeat(32), status: 'sent' });
        expect(got(peer).some(m => m.t === 'music-invite')).toBe(false);
        expect(JSON.stringify([...inbox.values()])).not.toContain(invite);
        expect(JSON.stringify(L.roomSnapshot())).not.toContain(invite);
        expect(got(guest).some(m => m.t === 'join' && m.ch.name === room)).toBe(false);
        accept(peer, pending);
        expect(delivered(peer)).toHaveLength(0);
        accept(guest, pending);
        const guestFrames = got(guest);
        expect(delivered(guest)).toEqual([expect.objectContaining({ id: pending.id, href: invite })]);
        expect(guestFrames.findIndex(m => m.t === 'join' && m.ch.name === room)).toBeLessThan(guestFrames.indexOf(delivered(guest)[0]));
        accept(guest, pending);
        expect(delivered(guest)).toHaveLength(1);
        expect(JSON.stringify(got(host))).not.toContain(invite);
        expect(JSON.stringify(got(peer))).not.toContain(invite);
        L.disconnect(guest.id);
        const returning = join(guest.nick);
        cmd(returning, 'join', [room]);
        expect(got(returning).filter(m => m.t === 'join' && m.ch.name === room)).toHaveLength(1);
        accept(returning, pending);
        expect(delivered(returning)).toHaveLength(0);
        cmd(returning, 'part', [], room);
        cmd(returning, 'join', [room]);
        expect(got(returning).filter(m => m.t === 'join' && m.ch.name === room)).toHaveLength(1);
    });
    it('refuses a nonhost, a different room instance, and an invalid browser destination', () => {
        expect(offer(peer)).toBeUndefined();
        expect(offer(host, { roomInstance: '0'.repeat(32) })).toBeUndefined();
        expect(offer(host, { href: invite.replace('/join/', '/other/') })).toBeUndefined();
        expect(offer(host, { href: invite.replace(origin, 'https://another.example.test') })).toBeUndefined();
        expect(got(host).at(-1)).toEqual({ t: 'music-invite-result', request: 'd'.repeat(32), status: 'unavailable' });
    });
    it('refuses expired offers and offers whose host has left', () => {
        const expired = offer();
        later(61_000);
        accept(guest, expired);
        invite = invite.replace(/&e=\d+$/, `&e=${clock / 1000 + 60}`);
        const pending = offer();
        cmd(host, 'part', [], room);
        accept(guest, pending);
        expect(delivered(guest)).toHaveLength(0);
        expect(got(guest).filter(m => m.t === 'music-invite-ended').map(m => m.id)).toContain(expired.id);
    });
    it.each([
        ['the host leaves the room', () => cmd(host, 'part', [], room)],
        ['the host disconnects', () => L.disconnect(host.id)],
        ['the room closes', () => cmd(host, 'close', [], room)],
        ['the relay expires the offer', () => { later(61_000); L.tick(); }],
    ])('ends the offer immediately for the selected guest when %s', (_reason, end) => {
        const pending = offer();
        end();
        const ended = { t: 'music-invite-ended', id: pending.id };
        expect(got(guest).filter(m => m.t === ended.t)).toEqual([ended]);
        expect(got(peer)).not.toContainEqual(ended);
        expect(JSON.stringify(got(guest))).not.toContain(invite);
        accept(guest, pending);
        expect(delivered(guest)).toHaveLength(0);
    });
    it('does not transfer an unaccepted invitation to a new connection for the same bandmate', () => {
        const pending = offer();
        L.disconnect(guest.id);
        const reconnected = join(guest.nick);
        expect(reconnected.id).not.toBe(guest.id);
        expect(got(reconnected).some(m => m.t === 'music-invite')).toBe(false);
        accept(reconnected, pending);
        expect(delivered(reconnected)).toHaveLength(0);
        expect(got(reconnected).some(m => m.t === 'join' && m.ch.name === room)).toBe(false);
    });
});

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
    it('"you" after a music compliment is the listener, but "on her/him/you" is about a person', () => {
        for (const ok of ['nice ass riff you got there', 'big ass amp you brought', 'nice ass solo you played']) expect(checkText(ok).verdict, ok).toBe('ok');
        for (const t of ['nice ass guitar on her', 'nice ass guitar on him', 'nice ass bass on you', 'great ass drums on that girl']) expect(checkText(t).verdict, t).not.toBe('ok');
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
        namedCmd(a, 'slap', ['Bravo']);
        expect(lines(b)).toContain('slaps Bravo around a bit with a large trout');
        later(61000);
        cmd(a, 'nick', ['Alfa']);
        expect(got(b).some((m) => m.t === 'event' && /Alpha is now known as Alfa/.test(m.text))).toBe(true);
        cmd(a, 'nick', ['Alfa2']);
        expect(notices(a)).toMatch(/One nick change per minute/);
        namedCmd(b, 'whois', ['Alfa']);
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
        namedCmd(b, 'ignore', ['Alpha']);
        say(a, 'hello there');
        expect(lines(b)).not.toContain('hello there');
        cmd(a, 'quit', ['bye']);
        expect(closed.some(([id]) => id === a.id)).toBe(true);
    });
});

describe('chat starts when a visitor joins', () => {
    it('does not replay lobby messages or events to late or reconnected guests', () => {
        const host = join('EarlyGuest');
        say(host, 'words before anyone else arrived');
        const late = join('LateGuest');
        const admission = got(late).find((frame) => frame.t === 'join');
        expect(admission).not.toHaveProperty('history');
        expect(JSON.stringify(got(late))).not.toContain('words before anyone else arrived');
        expect(got(late).filter((frame) => frame.t === 'event').map((frame) => frame.text)).not.toContain('EarlyGuest has joined #stalemate');
        later(4000);
        say(host, 'words arriving live');
        expect(lines(late)).toContain('words arriving live');
        L.disconnect(late.id);
        const back = join('LateGuest');
        expect(got(back).find((frame) => frame.t === 'join')).not.toHaveProperty('history');
        expect(lines(back)).toEqual([]);
    });

    it('does not replay room messages after a part and rejoin', () => {
        const host = join('RoomHost');
        const guest = join('RoomGuest');
        const name = '#gardenclub';
        cmd(host, 'join', [name]);
        say(host, 'before the room guest arrived', name);
        cmd(guest, 'join', [name]);
        expect(got(guest).find((frame) => frame.t === 'join' && frame.ch.name === name)).not.toHaveProperty('history');
        expect(lines(guest)).not.toContain('before the room guest arrived');
        later(1000);
        say(host, 'we are here together', name);
        expect(lines(guest)).toContain('we are here together');
        cmd(guest, 'part', [name]);
        later(1000);
        say(host, 'while the room guest was away', name);
        inbox.set(guest.id, []);
        cmd(guest, 'join', [name]);
        expect(lines(guest)).toEqual([]);
        expect(got(guest).find((frame) => frame.t === 'join')).not.toHaveProperty('history');
    });

    it('keeps bounded report context separate from visitor join payloads and durable snapshots', () => {
        boot({ moderationContext: 3 });
        const speaker = join('Speaker');
        const witness = join('Witness', { iph: 'witness-home' });
        for (const text of ['oldest words', 'a little context', 'the reported words', 'a final response']) {
            later(4000); say(speaker, text);
        }
        const room = L._debug.channels.get(LOBBY);
        expect(room.moderationContext.map((line) => line.text)).toEqual(['a little context', 'the reported words', 'a final response']);
        expect(JSON.stringify(L.snapshot())).not.toContain('the reported words');
        const reported = got(witness).find((frame) => frame.t === 'line' && frame.text === 'the reported words');
        L.message(witness.id, JSON.stringify({ t: 'report', id: reported.id }));
        expect(L.adminState().reports[0].context).toContain('<Speaker> a little context');
        const late = join('AfterReport');
        expect(JSON.stringify(got(late))).not.toContain('the reported words');
        const band = join('Drummer', { role: 'band' });
        inbox.set(late.id, []);
        cmd(band, 'dismiss', [reported.id]);
        expect(lines(late)).toEqual([]);
        expect(L._debug.reports.get(reported.id).done).toBe(true);
    });
});

describe('guest-hosted chat channels', () => {
    it.each([
        ['#hangs', 'chat'], ['#watchmakers', 'chat'], ['#artistclub', 'chat'],
        ['#watch', 'watch'], ['#watch-together', 'watch'], ['#art-sketch', 'art'],
        ['#bobross', 'bobross'], ['#jam-garage', 'jam']
    ])('%s chooses %s without treating arbitrary name prefixes as activities', (name, kind) => {
        const host = join('GuestHost');
        cmd(host, 'join', [name]);
        const room = L._debug.channels.get(name);
        expect(room.kind).toBe(kind);
        expect(room.ops.has('dev-GuestHost')).toBe(true);
        if (kind === 'chat') {
            expect(room.modes.C).toBe(false);
            expect(got(host).find((frame) => frame.t === 'join' && frame.ch.name === name).act).toBeNull();
            expect(notices(host)).toContain('room host runs this conversation');
        }
    });

    it('keeps chat text-only through host mode commands and a shield cycle', () => {
        const host = join('GuestHost');
        const guest = join('GuestPal');
        const band = join('Drummer', { role: 'band' });
        const name = '#gardenclub';
        cmd(host, 'join', [name]); cmd(guest, 'join', [name]);
        cmd(host, 'topic', ['Garden', 'chat'], name);
        expect(L._debug.channels.get(name).topic).toBe('Garden chat');
        cmd(host, 'mode', ['+C'], name);
        L.message(host.id, JSON.stringify({ t: 'cam', ch: name, on: true, adult18: true }));
        expect(L._debug.conns.get(host.id).cams.size).toBe(0);
        expect(notices(host)).toContain('Cameras belong in activity rooms');
        cmd(band, 'shield'); cmd(band, 'shieldoff');
        expect(L._debug.channels.get(name).modes.C).toBe(false);
        inbox.set(guest.id, []);
        L.message(host.id, JSON.stringify({ t: 'act', ch: name, kind: 'rtc', to: guest.id, sdp: { type: 'offer', sdp: 'test' } }));
        expect(got(guest).some((frame) => frame.t === 'act')).toBe(false);
        say(host, 'chat still works', name);
        expect(lines(guest)).toContain('chat still works');
    });
});

describe('permissions are enforced on the server (forged commands)', () => {
    const chanop = Object.entries(COMMANDS).filter(([, s]) => s === 'chanop').map(([k]) => k);
    const band = Object.entries(COMMANDS).filter(([, s]) => s === 'band').map(([k]) => k);
    it('a plain fan is denied every op and band command, and each attempt is logged', () => {
        const fan = join('Fan');
        join('Victim');
        for (const name of [...chanop, ...band]) {
            later(1000);
            if (['kick', 'ban', 'invite', 'op', 'deop', 'voice', 'devoice', 'cohost', 'transfer'].includes(name)) namedCmd(fan, name, ['Victim', 'x']);
            else cmd(fan, name, ['Victim', 'x']);
        }
        const denied = got(fan).filter((m) => m.t === 'denied').map((m) => m.cmd);
        expect(denied.sort()).toEqual([...chanop, ...band].sort());
        expect(L.modlog.filter((e) => e.action === 'denied').length).toBe(chanop.length + band.length);
        expect(closed.length).toBe(0);
    });
    it('typed /kick and raw {t:"cmd"} frames are treated the same', () => {
        const fan = join('Fan');
        const v = join('Victim');
        say(fan, '/kick Victim lol');
        L.message(fan.id, JSON.stringify({ t: 'cmd', name: 'mode', args: ['+o', 'Fan'], ch: LOBBY, personNamed: true }));
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
        namedCmd(a, 'kick', ['Charlie'], '#watch-b');
        namedCmd(a, 'kick', ['Charlie'], LOBBY);
        expect(got(a).filter((m) => m.t === 'denied').length).toBe(2);
        namedCmd(b, 'kick', ['Charlie', 'bye'], '#watch-b');
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
        namedCmd(a, 'ban', ['Troll', 'rude'], '#art-ban');
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
        namedCmd(a, 'voice', ['Bravo'], '#art-sketch');
        later(4000);
        say(b, 'now I can', '#art-sketch');
        expect(lines(a)).toContain('now I can');
        namedCmd(a, 'op', ['Bravo'], '#art-sketch');
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
        namedCmd(a, 'invite', ['Bravo'], '#watch-x');
        expect(got(b).some((m) => m.t === 'invite')).toBe(true);
        cmd(b, 'join', ['#watch-x']);
        expect(L._debug.channels.get('#watch-x').members.has(b.id)).toBe(true);
    });
});

describe('PMs are accept-first, blockable, switchable and need lobby time', () => {
    it('full flow', () => {
        const a = join('Alpha');
        const b = join('Bravo');
        namedCmd(a, 'msg', ['Bravo', 'hey']);
        expect(notices(a)).toMatch(/Hang in the lobby/);
        later(2 * 60 * 1000 + 1);
        namedCmd(a, 'msg', ['Bravo', 'hey', 'great', 'set']);
        expect(got(b).some((m) => m.t === 'pm-request' && m.from === 'Alpha')).toBe(true);
        expect(got(b).some((m) => m.t === 'pm')).toBe(false); // nothing delivered before accept
        namedCmd(b, 'accept', ['Alpha']);
        expect(got(b).find((m) => m.t === 'pm').text).toBe('hey great set');
        namedCmd(a, 'msg', ['Bravo', 'Private', 'contact', 'choice:', 'person@example.test']);
        expect(got(b).filter((m) => m.t === 'pm').length).toBe(2);
        expect(got(b).filter((m) => m.t === 'pm').at(-1).text).toBe('Private contact choice: person@example.test');
        namedCmd(b, 'block', ['Alpha']);
        namedCmd(a, 'msg', ['Bravo', 'yo']);
        expect(got(b).filter((m) => m.t === 'pm').length).toBe(2);
    });
    it('/pm off refuses requests; decline clears', () => {
        const a = join('Alpha');
        const b = join('Bravo');
        later(3 * 60 * 1000);
        cmd(b, 'pm', ['off']);
        namedCmd(a, 'query', ['Bravo']);
        expect(notices(a)).toMatch(/isn't taking PMs/);
        cmd(b, 'pm', ['on']);
        namedCmd(a, 'query', ['Bravo']);
        namedCmd(b, 'decline', ['Alpha']);
        namedCmd(a, 'msg', ['Bravo', 'pls']);
        expect(got(b).filter((m) => m.t === 'pm-request').length).toBe(2);
        expect(got(b).some((m) => m.t === 'pm')).toBe(false);
    });
    it('caps pending requests per sender', () => {
        const a = join('Alpha');
        for (const x of ['Bb1', 'Bb2', 'Bb3', 'Bb4', 'Bb5', 'Bb6']) join(x);
        later(3 * 60 * 1000);
        for (const x of ['Bb1', 'Bb2', 'Bb3', 'Bb4', 'Bb5', 'Bb6']) { later(21000); namedCmd(a, 'query', [x]); }
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

        const b = join('Bravo');
        const validAct = JSON.stringify({ t: 'act', ch: '#art-1', kind: 'rtc', sdp: { type: 'offer', sdp: 'v=0\r\n' + 'a=x'.repeat(4000) } });
        L.message(b.id, validAct);
        expect(closed.some(([id]) => id === b.id)).toBe(false);

        const c = join('Charlie');
        L.message(c.id, 'x'.repeat(20000));
        expect(closed.at(-1)).toEqual([c.id, 4400]);
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
        namedCmd(band, 'kick', ['Troll', 'chill']);
        expect(closed.some(([id]) => id === t.id)).toBe(true);
        expect(join('Troll', { iph: 'trollnet' }).refused.reason).toBe('kicked');
        later(11 * 60 * 1000);
        const t2 = join('Troll', { iph: 'trollnet' });
        namedCmd(band, 'ban', ['Troll']);
        expect(notices(band)).toMatch(/needs a reason/);
        namedCmd(band, 'ban', ['Troll', 'slurs']);
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
        namedCmd(band, 'mute', ['Fan', '5m']);
        later(4000);
        say(f, 'muted line');
        expect(notices(f)).toMatch(/muted/);
        namedCmd(band, 'purge', ['Fan']);
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
        namedCmd(band, 'kick', ['Fan', 'x']);
        const before = L.modlog.length;
        for (const name of Object.keys(COMMANDS)) cmd(band, name, ['log', 'x']);
        expect(L.modlog.length).toBeGreaterThanOrEqual(before);
        expect(L.modlog[0].action).toBe('kick');
    });
});

describe('reports', () => {
    it('auto-hides at 3 distinct devices; same device or same IP hash counts once', () => {
        const bad = join('Bad');
        const r1 = join('Rep1', { iph: 'a' });
        const r1b = join('Rep1b', { iph: 'a' });
        const r2 = join('Rep2', { iph: 'b' });
        const r3 = join('Rep3', { iph: 'c' });
        say(bad, 'you all stink');
        const id = got(bad).find((m) => m.t === 'line').id;
        L.message(r1.id, JSON.stringify({ t: 'report', id }));
        L.message(r1.id, JSON.stringify({ t: 'report', id }));
        L.message(r1b.id, JSON.stringify({ t: 'report', id }));
        expect(L._debug.reports.get(id).devs.size).toBe(1);
        L.message(r2.id, JSON.stringify({ t: 'report', id }));
        expect(L._debug.reports.get(id).hidden).toBe(false);
        L.message(r3.id, JSON.stringify({ t: 'report', id }));
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

describe('open community and explicit safety recovery', () => {
    it('stays open for guest conversation and hosting after days without a band member', () => {
        const fan = join('Fan');
        const pal = join('Pal');
        later(3 * 24 * 60 * 60 * 1000);
        L.tick();
        expect(L._debug.net.lock).toBe('off');
        expect(L._debug.net.shield).toBe(false);
        expect(L._debug.net.shieldAuto).toBe(false);
        say(fan, 'still here together');
        expect(lines(pal)).toContain('still here together');
        cmd(fan, 'join', ['#still-open']);
        expect(L._debug.channels.get('#still-open').ops.has('dev-Fan')).toBe(true);
        expect(L.modlog.some((entry) => entry.action.startsWith('auto-'))).toBe(false);
    });
    it('a manual read-only action still pauses guest PMs while band PMs remain available', () => {
        const a = join('Alpha');
        const b = join('Bravo');
        later(2 * 60 * 1000 + 1);
        namedCmd(a, 'msg', ['Bravo', 'hey']);
        namedCmd(b, 'accept', ['Alpha']);
        namedCmd(a, 'msg', ['Bravo', 'still', 'open']);
        expect(got(b).filter((m) => m.t === 'pm').map((m) => m.text)).toContain('still open');
        const band = join('Drummer', { role: 'band' });
        cmd(band, 'lobby', ['readonly']);
        L.disconnect(band.id);
        later(25 * 60 * 60 * 1000);
        L.tick();
        expect(L._debug.net.lock).toBe('readonly');
        inbox.clear();
        namedCmd(a, 'msg', ['Bravo', 'after', 'lock']);
        namedCmd(a, 'query', ['Bravo', 'after', 'lock']);
        expect(got(b).some((m) => m.t === 'pm')).toBe(false);
        expect(notices(a)).toMatch(/read-only/);
        const band2 = join('Singer', { role: 'band' });
        namedCmd(band2, 'msg', ['Bravo', 'band', 'here']);
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
    it('fails closed on malformed mutes, filter lists and stats, without throwing', () => {
        const base = { lock: 'off', bans: [], budget: { day: '', requests: 0 } };
        const cases = [
            { mutes: 'x' }, { mutes: { 'dev-a': 'soon' } }, { mutes: [1, 2] },
            { lists: 'x' }, { lists: { block: 'nword' } }, { lists: { block: [5, 'ok'] } }, { lists: { hold: [null] } },
            { stats: 'x' }, { stats: { hours: [], kinds: {}, rooms: {}, mod: {}, reports: {} } }, { stats: { hours: { h: { joins: 'a' } }, kinds: {}, rooms: {}, mod: {}, reports: { made: 0, autoHidden: 0, dismissed: 0, actioned: 0 } } }
        ];
        for (const extra of cases) {
            boot();
            expect(() => L.restore({ ...base, ...extra }), JSON.stringify(extra)).not.toThrow();
            expect(L._debug.net.lock, JSON.stringify(extra)).toBe('readonly');
            expect(() => L.adminState()).not.toThrow();
            const f = join('Fan'); const p = join('Pal');
            say(f, 'hi');
            expect(lines(p)).not.toContain('hi');
            const band = join('Drummer', { role: 'band' });
            expect(() => L.tick()).not.toThrow();
            cmd(band, 'lobby', ['unlock']);
            later(4000);
            say(f, 'hi again');
            expect(lines(p)).toContain('hi again');
        }
        boot();
        L.restore({ ...base, mutes: { 'dev-Muted': clock + 60000, bad: 'x' }, lists: { block: ['badword', 7], hold: [], allow: [] } });
        expect(L._debug.net.mutes).toEqual({ 'dev-Muted': clock + 60000 }); // good entries survive
        expect(L._debug.net.lists.block).toEqual(['badword']);
        boot();
        L.restore({ ...base, mutes: { 'dev-a': clock + 1 }, lists: { block: ['x'], hold: [], allow: [] }, stats: { hours: {}, kinds: { art: 2 }, rooms: {}, mod: {}, reports: { made: 1, autoHidden: 0, dismissed: 0, actioned: 0 } } });
        expect(L._debug.net.lock).toBe('off'); // well-formed state is respected
        expect(L.adminState().stats.reports.made).toBe(1);
    });
    it('fails closed on malformed lastBand, kicks, shield and reportsToHide', () => {
        const base = { lock: 'off', bans: [], budget: { day: '', requests: 0 } };
        for (const extra of [{ kicks: 'x' }, { kicks: { 'dev-a': 'soon' } }, { shield: 'yes' }, { shieldAuto: 1 }, { reportsToHide: 0 }, { reportsToHide: 'three' }, { reportsToHide: 2.5 }, { reportsToHide: 999 }]) {
            boot();
            expect(() => L.restore({ ...base, ...extra }), JSON.stringify(extra)).not.toThrow();
            expect(L._debug.net.lock, JSON.stringify(extra)).toBe('readonly');
            expect(() => L.tick()).not.toThrow();
            const f = join('Fan'); const p = join('Pal');
            say(f, 'hi');
            expect(lines(p)).not.toContain('hi');
        }
        boot(); L.restore({ ...base, shield: 'yes' });
        expect(L._debug.net.shield).toBe(true);
        boot(); L.restore({ ...base, reportsToHide: -4 });
        expect(L._debug.net.reportsToHide).toBe(3);
        boot(); L.restore({ ...base, kicks: { 'dev-Troll': clock + 60000, bad: null } });
        expect(L._debug.net.kicks).toEqual({ 'dev-Troll': clock + 60000 });
        expect(join('Troll').refused.reason).toBe('kicked');
        for (const lastBand of ['yesterday', -1, Number.NaN, clock + 365 * 24 * 60 * 60 * 1000, null]) {
            boot();
            L.restore({ ...base, lastBand });
            expect(L._debug.net.lastBand, String(lastBand)).toBe(0); // treated as stale
            L.tick();
            expect(L._debug.net.shield).toBe(false); // malformed storage locks safely, presence does not raise a shield
            expect(L._debug.net.lock).toBe('readonly');
        }
        boot(); L.restore({ ...base, lastBand: clock - 1000, shield: false, kicks: {}, reportsToHide: 5 });
        L.tick();
        expect(L._debug.net.lock).toBe('off'); // well-formed state is respected
        expect(L._debug.net.shield).toBe(false);
        expect(L._debug.net.reportsToHide).toBe(5);
    });
    it('caps bans at runtime too: network list keeps the newest banMax, rooms keep the newest roomBanMax', () => {
        boot();
        const band = join('Drummer', { role: 'band', iph: 'bandnet' });
        L._debug.net.bans.push(...Array.from({ length: 5000 }, (_, i) => ({ mask: `dev:old${i}`, reason: 'x', by: 'B', at: i })));
        const t = join('Troll', { iph: 'trollnet' });
        namedCmd(band, 'gban', ['Troll', 'spam']); // pushes 3 more: 5003 -> 5000
        const net = L._debug.net.bans;
        expect(net.length).toBe(5000);
        expect(net.slice(-3).map((b) => b.mask)).toEqual(['dev:dev-Troll', 'iph:trollnet', 'nick:troll']);
        expect(net[0].mask).toBe('dev:old3'); // oldest three dropped
        expect(join('Troll', { iph: 'elsewhere' }).refused.reason).toBe('banned');
        expect(t.id).toBeTruthy();

        boot();
        const a = join('Alpha', { iph: 'home' });
        cmd(a, 'join', ['#art-cap']);
        const room = L._debug.channels.get('#art-cap');
        room.bans.push(...Array.from({ length: 500 }, (_, i) => ({ mask: `dev:r${i}`, reason: 'x', by: 'Alpha', at: i })));
        const v = join('Vandal', { iph: 'vnet' });
        cmd(v, 'join', ['#art-cap']);
        namedCmd(a, 'ban', ['Vandal', 'rude'], '#art-cap');
        expect(room.bans.length).toBe(500);
        expect(room.bans.slice(-3).map((b) => b.mask)).toEqual(['dev:dev-Vandal', 'nick:vandal', 'iph:vnet']);
        expect(room.bans[0].mask).toBe('dev:r3');
        expect(room.members.has(v.id)).toBe(false);
    });
    it('caps filter lists and stored bans', () => {
        const base = { lock: 'off', budget: { day: '', requests: 0 } };
        const words = Array.from({ length: 2500 }, (_, i) => `w${i}`);
        boot();
        L.restore({ ...base, bans: [], lists: { block: words, hold: words, allow: words } });
        for (const k of ['block', 'hold', 'allow']) expect(L._debug.net.lists[k].length).toBe(2000);
        expect(L._debug.net.lock).toBe('readonly');
        const bans = Array.from({ length: 6000 }, (_, i) => ({ mask: `dev:d${i}`, reason: 'x', by: 'B', at: i }));
        boot();
        L.restore({ ...base, bans });
        expect(L._debug.net.bans.length).toBe(5000);
        expect(L._debug.net.bans.at(-1).mask).toBe('dev:d5999'); // newest kept
        expect(L._debug.net.lock).toBe('readonly');
        boot();
        L.restore({ ...base, bans: [], lists: { block: words.slice(0, 2000), hold: [], allow: [] } });
        expect(L._debug.net.lock).toBe('off'); // exactly at the cap is fine
        const band = join('Drummer', { role: 'band' });
        cmd(band, 'filter', ['block', 'onemore']);
        expect(L._debug.net.lists.block.length).toBe(2000);
        expect(L._debug.net.lists.block).not.toContain('onemore');
        expect(notices(band)).toMatch(/list is full/);
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
    it('preserves legacy or corruption-triggered saved locks until a band member explicitly recovers', () => {
        const fan = join('Fan');
        const pal = join('Pal');
        cmd(fan, 'join', ['#hangs']);
        cmd(pal, 'join', ['#hangs']);
        later(23 * 60 * 60 * 1000);
        L.tick();
        expect(L._debug.net.lock).toBe('off');
        later(60 * 60 * 1000 + 1);
        L.restore({ lock: 'readonly', lockAuto: true, shield: true, shieldAuto: true });
        L.tick();
        expect(L._debug.net.lock).toBe('readonly');
        expect(L._debug.net.lockAuto).toBe(true);
        expect(L.adminState().lockAuto).toBe(true);
        expect(L.adminState().shieldAuto).toBe(true);
        inbox.clear();
        say(fan, 'anyone here?');
        say(fan, 'room chat', '#hangs');
        expect(lines(pal)).toEqual([]);
        expect(notices(fan)).toMatch(/read-only/);
        L.message(fan.id, JSON.stringify({ t: 'cmd', name: 'msg', args: ['Pal', 'psst'], ch: LOBBY }));
        expect(got(pal).some((m) => m.t === 'pm-request' || m.t === 'pm')).toBe(false);
        expect(L.modlog.map((e) => e.action)).not.toContain('auto-lockdown');
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
        namedCmd(band, 'kick', ['Alpha', 'x']);
        const s = L.adminState().stats;
        expect(Object.values(s.days)[0].joins).toBe(2);
        expect(s.kinds.bobross).toBe(1);
        expect(s.mod['filter:personal-info']).toBe(1);
        expect(s.mod.kick).toBe(1);
        const text = JSON.stringify(s);
        expect(text).not.toMatch(/Alpha|dev-|ip1/);
    });
});

describe('open-room paint + synced video (act frames)', () => {
    const act = (u, ch, body) => L.message(u.id, JSON.stringify({ t: 'act', ch, ...body }));
    it('relays strokes, clear-by-@ and host-only video', () => {
        const host = join('Host');
        const guest = join('Guest');
        cmd(host, 'join', ['#art-sync']);
        cmd(guest, 'join', ['#art-sync']);
        inbox.set(host.id, []);
        inbox.set(guest.id, []);
        act(guest, '#art-sync', { kind: 'stroke', stroke: { id: 's1', color: '#009ee8', size: 4, pts: [[0.1, 0.2]] } });
        expect(got(host).some((m) => m.t === 'act' && m.kind === 'stroke')).toBe(true);
        act(guest, '#art-sync', { kind: 'clear' });
        expect(notices(guest)).toMatch(/Only @ can clear/);
        act(host, '#art-sync', { kind: 'clear' });
        expect(got(guest).some((m) => m.t === 'act' && m.kind === 'clear')).toBe(true);
        cmd(host, 'join', ['#watch-sync']);
        cmd(guest, 'join', ['#watch-sync']);
        inbox.set(host.id, []);
        inbox.set(guest.id, []);
        act(guest, '#watch-sync', { kind: 'video', source: { kind: 'yt', id: 'oh5p5f5_-7A' }, playing: true, pos: 3 });
        expect(got(host).some((m) => m.t === 'act' && m.kind === 'video')).toBe(false);
        act(host, '#watch-sync', { kind: 'video', source: { kind: 'yt', id: 'oh5p5f5_-7A' }, playing: true, pos: 3 });
        expect(got(guest).some((m) => m.t === 'act' && m.kind === 'video')).toBe(true);
    });
});

describe('Game Night', () => {
    it('detects four in every direction, full columns and a draw without changing earlier positions', () => {
        const start = { ...openFour('fixture', 'host'), guest: 'guest' };
        const diagonal = [0, 1, 1, 2, 4, 2, 2, 3, 4, 3, 4, 3, 3];
        for (const moves of [[0, 0, 1, 1, 2, 2, 3], [0, 1, 0, 1, 0, 1, 0], diagonal, diagonal.map(col => 6 - col)]) {
            const result = moves.reduce(dropFour, start);
            expect(result.winner).toBe('X');
            expect(fourFinished(result)).toBe(true);
            expect(dropFour(result, 6)).toBeNull();
        }
        expect(start.board.every(cell => !cell)).toBe(true);
        const full = [0, 0, 0, 0, 0, 0].reduce(dropFour, start);
        expect(dropFour(full, 0)).toBeNull();
        const draw = [3, 6, 1, 2, 5, 1, 3, 2, 1, 3, 4, 6, 0, 4, 2, 3, 4, 3, 4, 5, 4,
            2, 6, 0, 2, 2, 3, 1, 6, 5, 6, 0, 1, 5, 0, 0, 5, 5, 1, 4, 0, 6].reduce(dropFour, start);
        expect(draw).toMatchObject({ moves: 42, winner: '' });
        expect(fourFinished(draw)).toBe(true);
    });

    it('binds the board to the invite-only room, both seats and the current turn', () => {
        boot({}, true);
        const host = join('GameHost');
        const guest = join('GameGuest');
        const observer = join('GameObserver');
        const outsider = join('GameOutsider');
        const room = '#game-1acbefx23acbe';
        cmd(host, 'join', [room]);
        const ref = got(host).findLast(m => m.t === 'join').ch.keepRef;
        const state = visitor => got(visitor).findLast(m => m.t === 'four' && m.ch === room)?.game;
        const play = (visitor, args, roomInstance = ref) => {
            later(2000);
            return L.message(visitor.id, JSON.stringify({ t: 'cmd', name: 'four', args, ch: room, roomInstance }));
        };
        for (const visitor of [guest, observer]) {
            namedCmd(host, 'invite', [visitor.nick], room);
            cmd(visitor, 'join', [room]);
        }
        play(guest, ['open']);
        play(outsider, ['open']);
        play(host, ['open'], '0'.repeat(32));
        expect(state(host)).toBeUndefined();
        play(host, ['open']);
        const { id } = state(host);
        expect(state(observer)).toMatchObject({ id, guest: '', moves: 0 });
        play(guest, ['join', id]);
        play(observer, ['join', id]);
        play(guest, ['drop', id, '0', '1']);
        play(host, ['drop', id, '0', '0']);
        expect(state(guest)).toMatchObject({ guest: guest.id, moves: 0 });
        play(host, ['drop', id, '0', '4']);
        play(host, ['drop', id, '0', '2']);
        play(guest, ['drop', id, '0', '2']);
        play(observer, ['drop', id, '1', '2']);
        expect(state(guest)).toMatchObject({ moves: 1, lastColumn: 3 });
        play(guest, ['drop', id, '1', '2']);
        expect(state(guest).board.slice(-7)).toEqual(['', 'O', '', 'X', '', '', '']);
        expect(state(outsider)).toBeUndefined();
        expect(JSON.stringify(L.roomSnapshot())).not.toContain(id);
        namedCmd(host, 'block', [guest.nick], room);
        expect(state(guest)).toBeNull();
        play(host, ['open']);
        const replacement = state(host).id;
        play(guest, ['join', replacement]);
        expect(state(host).guest).toBe('');
        play(observer, ['join', replacement]);
        play(host, ['drop', id, '0', '4']);
        expect(state(host).moves).toBe(0);
        L.disconnect(observer.id);
        expect(state(guest)).toBeNull();
    });

    it('only accepts HTTPS Discord invites and server channel links', () => {
        for (const url of ['https://discord.gg/GameNight_01', 'https://discord.com/invite/ABC-xyz',
            'https://discord.com/channels/123456789012345678/234567890123456789']) {
            expect(discordCallLink(` ${url} `)).toBe(url);
        }
        for (const url of ['http://discord.gg/abc', 'https://discord.gg.evil.test/abc', 'https://discord.gg@evil.test/abc',
            'https://example.com/discord.gg/abc', 'https://discord.gg:443/abc', 'https://discord.gg/%61bc',
            'https://discord.gg/abc?redirect=evil', 'https://discord.gg/abc#frag', 'https://discord.com/channels/@me/234567890123456789']) {
            expect(discordCallLink(url), url).toBe('');
        }
    });

    it('shares a live link only with invited players and retires it with the sharing host', () => {
        boot({}, true);
        const host = join('GameHost');
        const guest = join('GameGuest');
        const stranger = join('UninvitedFan');
        const room = '#game-9cde12x9df823';
        const first = 'https://discord.gg/GameNight_01';
        const second = 'https://discord.com/invite/GameNight_02';
        const latestRoom = (person) => got(person).findLast(m => ['join', 'chan'].includes(m.t) && m.ch.name === room)?.ch;
        cmd(host, 'join', [room]);
        expect(latestRoom(host)).toMatchObject({ kind: 'game', modes: { i: true, C: false }, gameCall: '' });
        const nonce = latestRoom(host).keepRef;
        const share = (person, value, roomInstance = nonce) =>
            L.message(person.id, JSON.stringify({ t: 'cmd', name: 'discord', args: [value], ch: room, roomInstance }));
        cmd(host, 'mode', ['-i'], room);
        expect(notices(host)).toContain('Game Night stays invite-only');
        cmd(stranger, 'join', [room]);
        expect(latestRoom(stranger)).toBeUndefined();
        namedCmd(host, 'invite', [guest.nick], room);
        cmd(guest, 'join', [room]);
        share(host, first, '0'.repeat(32));
        share(host, 'https://example.com/fake');
        share(guest, first);
        expect(latestRoom(guest).gameCall).toBe('');
        share(host, first);
        expect(latestRoom(guest).gameCall).toBe(first);
        expect(JSON.stringify(got(stranger))).not.toContain(first);
        expect(JSON.stringify(got(guest).filter(m => !['join', 'chan'].includes(m.t)))).not.toContain(first);
        expect(JSON.stringify(L.roomSnapshot())).not.toContain(first);
        expect(L.roomSnapshot().rooms[0]).toMatchObject({ kind: 'chat', modes: { i: true, C: false } });
        share(host, 'clear');
        expect(latestRoom(guest).gameCall).toBe('');
        namedCmd(host, 'op', [guest.nick], room);
        share(guest, second);
        expect(latestRoom(host).gameCall).toBe(second);
        namedCmd(host, 'deop', [guest.nick], room);
        expect(latestRoom(host).gameCall).toBe('');
        share(host, first);
        L.disconnect(host.id);
        expect(latestRoom(guest).gameCall).toBe('');
    });

    it('keeps the public engine on ordinary chat and leaves Discord sharing unavailable', () => {
        const host = join('GameHost');
        const room = '#game-3adfc4xc61437';
        cmd(host, 'join', [room]);
        expect(got(host).find(m => m.t === 'hello').features).not.toHaveProperty('gameNight');
        const view = got(host).findLast(m => m.t === 'join').ch;
        expect(view).toMatchObject({ kind: 'chat', modes: { i: false } });
        cmd(host, 'discord', ['https://discord.gg/GameNight_01'], room);
        expect(JSON.stringify(got(host))).not.toContain('https://discord.gg/');
    });

    it('restores a private room and drops its call link across engine restart', async () => {
        boot({}, true);
        const host = join('GameHost');
        const room = '#game-f4e0bfx372e4d';
        cmd(host, 'join', [room]);
        const old = L.roomSnapshot();
        // A rollback Worker knows this as a chat room and can open +i.
        // The new Worker restores Game Night as invite-only.
        old.rooms[0].modes.i = false;
        old.rooms[0].gameCall = { by: host.id, url: 'https://discord.gg/OldCall' };
        boot({}, true);
        await L.restoreRooms(old);
        const returning = join('GameHost');
        const uninvited = join('OtherFan');
        cmd(uninvited, 'join', [room]);
        expect(notices(uninvited)).toContain('invite-only');
        cmd(returning, 'join', [room]);
        expect(got(returning).findLast(m => m.t === 'join').ch)
            .toMatchObject({ kind: 'game', modes: { i: true, C: false }, gameCall: '' });
    });
});
