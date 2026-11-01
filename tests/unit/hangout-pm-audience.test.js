// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';

function fixture() {
    let time = 1800000000000, engine;
    const frames = [], identities = [];
    const boot = () => { engine = createLobby({ now: () => time, limits: { defaultSlow: 0 },
        send: (recipient, frame) => frames.push({ recipient, ...structuredClone(frame) }) }); };
    boot();
    const binding = (id, peer) => {
        const pair = engine.sessionSnapshot().pm.find(pair => pair.key === [id, peer].sort().join('|'));
        return pair?.ref ? { ch: `pm:${pair.ref}`, pmPeer: peer, pmRef: pair.ref } : {};
    };
    const command = (id, name, args = [], ch = '#stalemate') => engine.message(id, JSON.stringify({ t: 'cmd', name, args, ch,
        ...(ch.startsWith('pm:') && ['me', 'slap'].includes(name) ? binding(id, ch.slice(3)) : {}), ...(name === 'msg' ? { pmExplicit: true } : {}) }));
    // Explicit named commands, separate from the generic context-sensitive helper.
    const namedCommand = (id, name, args = [], ch = '#stalemate') => engine.message(id, JSON.stringify({ t: 'cmd', name, args, ch, personNamed: true }));
    const pm = id => frames.filter(frame => frame.recipient === id && frame.t === 'pm');
    function join(id, role = 'fan') {
        const identity = { id, dev: `device-${id}`, iph: `ip-${id}`, role, admin: role === 'owner', account: '' };
        identities.push(identity); expect(engine.connect(identity).ok).toBe(true);
        engine.message(id, JSON.stringify({ t: 'hello', nick: id, age13: true, pmPeers: 1 }));
    }
    function establish(role = 'fan') {
        join('Sender', role); join('Recipient'); join('Observer'); time += 180000;
        namedCommand('Sender', 'query', ['Recipient']); namedCommand('Recipient', 'accept', ['Sender']);
        frames.length = 0;
    }
    return { get engine() { return engine; }, binding, command, namedCommand, pm, frames, join, establish, later: ms => { time += ms; },
        wake() {
            const saved = structuredClone({ net: engine.snapshot(), rooms: engine.roomSnapshot(), sessions: engine.sessionSnapshot() });
            time += 61000; boot(); engine.restore(saved.net); engine.restoreRooms(saved.rooms);
            const connected = new Set(saved.sessions.connections.map(connection => connection.id));
            expect(engine.restoreSessions(saved.sessions, identities.filter(identity => connected.has(identity.id))).rejected).toEqual([]);
            return saved;
        }
    };
}

describe('private composer audience and actions', () => {
    it('keeps a literal slash in the accepted private conversation without a channel fallback', () => {
        const f = fixture(); f.establish();
        f.engine.message('Sender', JSON.stringify({ t: 'say', ...f.binding('Sender', 'Recipient'), text: '//A private literal slash' }));
        expect(f.pm('Recipient')).toContainEqual(expect.objectContaining({ text: '/A private literal slash', me: false }));
        expect(f.frames.some(frame => frame.t === 'line')).toBe(false);
        expect(f.pm('Observer')).toEqual([]);
    });

    it.each([
        ['me', ['keeps this action private'], 'keeps this action private'],
        ['slap', ['Recipient'], 'slaps Recipient around a bit with a large trout']
    ])('delivers /%s only to the accepted counterpart, including after a same-socket wake', (name, args, text) => {
        const f = fixture(); f.establish(); f.wake();
        f.command('Sender', name, args, 'pm:Recipient');
        expect(f.pm('Recipient')).toContainEqual(expect.objectContaining({ from: 'Sender', text, me: true }));
        expect(f.pm('Sender')).toContainEqual(expect.objectContaining({ text, me: true }));
        expect(f.frames.some(frame => frame.t === 'line')).toBe(false);
        expect(f.pm('Observer')).toEqual([]);
        const saved = f.wake(); expect(JSON.stringify(saved)).not.toContain(text);
        const selected = f.pm('Recipient').at(-1);
        f.engine.message('Observer', JSON.stringify({ t: 'report', id: selected.id, text }));
        expect(f.engine.adminState().reports).toEqual([]);
        f.engine.message('Recipient', JSON.stringify({ t: 'report', id: selected.id, text }));
        expect(f.engine.adminState().reports[0]).toMatchObject({ text, ch: 'pm:Sender>Recipient' });
    });

    it('refuses implicit channel commands from a private context even for site staff', () => {
        const f = fixture(); f.establish('owner');
        const before = f.engine._debug.channels.get('#stalemate').topic;
        f.command('Sender', 'topic', ['This private draft must not become the lobby topic'], 'pm:Recipient');
        expect(f.engine._debug.channels.get('#stalemate').topic).toBe(before);
        expect(f.frames.some(frame => frame.recipient === 'Sender' && /choose a channel/i.test(frame.text || ''))).toBe(true);
        expect(f.frames.some(frame => frame.recipient === 'Observer' && JSON.stringify(frame).includes('private draft'))).toBe(false);
        f.command('Sender', 'me', ['Must not fall back'], 'pm:MissingNick');
        expect(f.frames.some(frame => frame.t === 'line')).toBe(false);
    });

    it('keeps explicit /help, /msg and /join usable while a private tab is selected', () => {
        const f = fixture(); f.establish();
        f.command('Sender', 'help', [], 'pm:Recipient');
        expect(f.frames.some(frame => frame.recipient === 'Sender' && /Everyone:/.test(frame.text || ''))).toBe(true);
        f.command('Sender', 'msg', ['Recipient', 'A complete private sentence with more than seven separate words'], 'pm:Recipient');
        expect(f.pm('Recipient').at(-1).text).toBe('A complete private sentence with more than seven separate words');
        f.command('Sender', 'join', ['#an-explicit-room'], 'pm:Recipient');
        expect(f.engine._debug.channels.get('#an-explicit-room').members.has('Sender')).toBe(true);
        expect(f.frames.some(frame => frame.t === 'line')).toBe(false);
    });

    it('requires renewed acceptance for a private action after real disconnect and loses pending action text on wake', () => {
        const f = fixture(); f.establish(); f.engine.disconnect('Sender');
        f.join('Returned'); f.later(180000); f.frames.length = 0;
        f.command('Returned', 'me', ['A pending private action is not a saved transcript'], 'pm:Recipient');
        expect(f.pm('Recipient')).toEqual([]);
        expect(f.frames.some(frame => frame.t === 'pm-request')).toBe(false);
        f.command('Returned', 'msg', ['Recipient', 'A pending private action is not a saved transcript'], 'pm:Recipient');
        expect(f.frames.some(frame => frame.recipient === 'Recipient' && frame.t === 'pm-request' && frame.from === 'Returned')).toBe(true);
        const saved = f.wake(); expect(JSON.stringify(saved)).not.toContain('A pending private action');
        f.namedCommand('Recipient', 'accept', ['Returned']);
        expect(f.pm('Recipient')).toEqual([]);
        expect(f.frames.some(frame => frame.recipient === 'Recipient' && /first message was not retained/.test(frame.text || ''))).toBe(true);
    });

    it('preserves ignore, block, mute and request-consent restrictions for private actions', () => {
        const f = fixture(); f.establish(); f.join('Staff', 'owner');
        f.namedCommand('Recipient', 'ignore', ['Sender']);
        f.command('Sender', 'me', ['An ignored private action'], 'pm:Recipient');
        expect(f.pm('Recipient')).toEqual([]);
        const echo = f.pm('Sender').at(-1);
        expect(echo).toMatchObject({ text: 'An ignored private action', me: true });
        f.engine.message('Recipient', JSON.stringify({ t: 'report', id: echo.id, text: echo.text }));
        expect(f.engine.adminState().reports).toEqual([]);
        f.namedCommand('Recipient', 'block', ['Sender']); f.later(4000);
        f.command('Sender', 'slap', ['Recipient'], 'pm:Recipient');
        expect(f.pm('Recipient')).toEqual([]);
        f.namedCommand('Recipient', 'unblock', ['Sender']); f.later(4000);
        f.command('Sender', 'me', ['An old context cannot create a new request'], 'pm:Recipient');
        expect(f.pm('Recipient')).toEqual([]);
        expect(f.frames.filter(frame => frame.t === 'pm-request')).toEqual([]);
        f.namedCommand('Sender', 'query', ['Recipient']);
        f.namedCommand('Recipient', 'accept', ['Sender']);
        f.command('Sender', 'me', ['A new request waits for acceptance'], 'pm:Recipient');
        expect(f.pm('Recipient')).toContainEqual(expect.objectContaining({ text: 'A new request waits for acceptance', me: true }));
        f.namedCommand('Staff', 'mute', ['Sender', '10m']); f.later(4000);
        f.command('Sender', 'me', ['A muted action'], 'pm:Recipient');
        expect(f.pm('Recipient')).toHaveLength(1);
    });
});
