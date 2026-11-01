import { describe, expect, it } from 'vitest';
import { createLobby, validWebjamInvitation } from '../../hangout-worker/src/lobby-core.mjs';

const LINK = 'webjam://join?v=3&r=direct-stun&i=opaque-fixture-only';
const INVITATION = `Join beta rehearsal on WebJam:\nKeep this room open.\nOpen WebJam, choose Join, then paste this full invitation.\n${LINK}\nwebjam-signal:V0pTRQ${'x'.repeat(3000)}`;
function harness() {
    const messages = [], writes = [], ai = [];
    const lobby = createLobby({ send: (id, message) => messages.push({ id, message }), persist: (kind, value) => writes.push({ kind, value }), reviewPublicText: (value) => ai.push(value) });
    const command = (id, name, args, ch = '#jam-fixture') => lobby.message(id, JSON.stringify({ t: 'cmd', ch, name, args }));
    for (const [id, nick] of [['host', 'JamHost'], ['guest', 'JamGuest']]) {
        lobby.connect({ id, dev: `dev-${id}`, iph: `ip-${id}`, role: 'fan' });
        lobby.message(id, JSON.stringify({ t: 'hello', nick, age13: true }));
    }
    command('host', 'join', ['#jam-fixture']); lobby.message('host', JSON.stringify({ t: 'cmd', name: 'invite', args: ['JamGuest'], ch: '#jam-fixture', personNamed: true })); command('guest', 'join', ['#jam-fixture']);
    return { lobby, command, messages, writes, ai };
}

describe('complete WebJam clipboard invitation handoff', () => {
    it('relays a complete invitation larger than ordinary chat frames without truncating its sealed line', () => {
        const { lobby, command, messages } = harness();
        command('host', 'jamlink', ['invitation', INVITATION]);
        const received = messages.filter(({ id, message }) => id === 'guest' && message.t === 'chan').at(-1).message.ch.jam;
        expect(received.invitation).toBe(INVITATION);
        expect(received.desktop).toBe(''); // the full message must be pasted
        expect(lobby._debug.channels.get('#jam-fixture').jam.invitation).toBe(INVITATION);
    });
    it('keeps app invitation material out of every durable snapshot and moderation log', () => {
        const { lobby, command, writes, ai } = harness();
        command('host', 'jamlink', ['invitation', INVITATION]);
        const durable = JSON.stringify({ rooms: lobby.roomSnapshot(), sessions: lobby.sessionSnapshot(), writes });
        expect(durable).not.toContain(LINK); expect(durable).not.toContain('webjam-signal:');
        expect(ai).toEqual([]);
    });
    it('permits only the host to replace or clear the shared invitation', () => {
        const { lobby, command } = harness();
        command('host', 'jamlink', ['invitation', INVITATION]);
        command('guest', 'jamlink', ['invitation', INVITATION.replace('beta rehearsal', 'replacement')]);
        command('guest', 'jamlink', ['clear']);
        expect(lobby._debug.channels.get('#jam-fixture').jam.invitation).toBe(INVITATION);
        command('host', 'jamlink', ['clear']);
        expect(lobby._debug.channels.get('#jam-fixture').jam.invitation).toBeUndefined();
    });
    it('rejects ambiguous, oversized and control-bearing clipboard messages without rewriting them', () => {
        expect(validWebjamInvitation(INVITATION)).toBe(INVITATION);
        expect(validWebjamInvitation(`${LINK}\n${LINK}`)).toBe('');
        expect(validWebjamInvitation(INVITATION+'x'.repeat(8192))).toBe('');
        expect(validWebjamInvitation(`${LINK}\u0000`)).toBe('');
        expect(validWebjamInvitation('https://example.com/join')).toBe('');
    });
});

describe('request-correlated WebJam share feedback', () => {
    const A = '1a'.repeat(16), B = '2b'.repeat(16);
    const share = (lobby, id, token, args = ['invitation', INVITATION]) => lobby.message(id, JSON.stringify({
        t: 'cmd', ch: '#jam-fixture', name: 'jamlink', args, jamRequestId: token,
        roomInstance: lobby._debug.channels.get('#jam-fixture').keepRef
    }));
    const results = messages => messages.filter(row => row.message.t === 'jam-share-result');

    it('advertises feedback and sends only the caller a bounded result after its room state', () => {
        const { lobby, messages, writes } = harness();
        expect(messages.find(row => row.id === 'host' && row.message.t === 'hello').message.features.jamShareResults).toBe(1);
        share(lobby, 'host', A);
        expect(results(messages)).toEqual([{ id: 'host', message: { t: 'jam-share-result', id: A, status: 'published' } }]);
        const response = messages.findIndex(row => row.message.t === 'jam-share-result');
        expect(messages.slice(0, response).some(row => row.id === 'host' && row.message.t === 'chan'
            && row.message.ch.name === '#jam-fixture' && row.message.ch.jam.invitation === INVITATION)).toBe(true);
        expect(JSON.stringify({ rooms: lobby.roomSnapshot(), sessions: lobby.sessionSnapshot(), writes, log: lobby.modlog })).not.toContain(A);
    });
    it('rejects an unconfigured origin without replacing the existing invitation or reflecting capabilities', () => {
        const { lobby, messages } = harness();
        share(lobby, 'host', A); share(lobby, 'host', B, ['web', 'https://unapproved.example/join/#fixture']);
        expect(results(messages).at(-1)).toEqual({ id: 'host', message: { t: 'jam-share-result', id: B, status: 'rejected' } });
        expect(lobby._debug.channels.get('#jam-fixture').jam.invitation).toBe(INVITATION);
    });
    it('never treats an echoed request ID as host permission', () => {
        const { lobby, messages } = harness();
        share(lobby, 'guest', A);
        expect(results(messages)).toEqual([{ id: 'guest', message: { t: 'jam-share-result', id: A, status: 'rejected' } }]);
        expect(lobby._debug.channels.get('#jam-fixture').jam.invitation).toBeUndefined();
    });
    it.each(['x'.repeat(32), 'A'.repeat(32), 'a'.repeat(33), { nested: A }, null])('does not reflect a malformed request ID: %j', token => {
        const { lobby, messages } = harness(); share(lobby, 'host', token);
        expect(results(messages)).toEqual([]);
    });
    it('does not attach invitation feedback to another command', () => {
        const { lobby, messages } = harness();
        lobby.message('host', JSON.stringify({ t: 'cmd', name: 'topic', ch: '#jam-fixture', args: ['Rehearsal'], jamRequestId: A }));
        expect(results(messages)).toEqual([]);
    });
    it('reports refusal under the unchanged command limit without bypassing it', () => {
        const { lobby, messages } = harness();
        for (let i = 0; i < 12; i++) share(lobby, 'host', i.toString(16).padStart(32, '0'));
        expect(results(messages)).toHaveLength(12);
        expect(results(messages).some(row => row.message.status === 'published')).toBe(true);
        expect(results(messages).at(-1).message.status).toBe('rejected');
    });
    it('withholds feedback with controlled output and discards it when the commit fails', async () => {
        // The real engine/output transaction uses a held/refusing commit
        // adapter here; this is not a native SQLite or provider execution test.
        const messages = []; let armed = false, refuse = false, release, entered;
        const reached = new Promise(resolve => { entered = resolve; });
        const lobby = createLobby({ send: (id, message) => messages.push({ id, message }), effectCommit: {
            prepare: () => ({}),
            commit: async (_context, _effects, { costsOnly }) => {
                if (armed && !costsOnly) { entered(); await new Promise(resolve => { release = resolve; }); }
                return { ok: costsOnly || !refuse };
            }
        } });
        await lobby.connect({ id: 'host', dev: 'device', iph: 'ip', role: 'fan' });
        await lobby.message('host', JSON.stringify({ t: 'hello', nick: 'CommitHost', age13: true }));
        await lobby.message('host', JSON.stringify({ t: 'cmd', name: 'join', args: ['#jam-fixture'] }));
        messages.length = 0; armed = true; refuse = true;
        const pending = share(lobby, 'host', A); await reached;
        expect(results(messages)).toEqual([]);
        expect(messages.some(row => row.message.t === 'chan')).toBe(false);
        release(); await pending;
        expect(results(messages)).toEqual([]);
        expect(messages.some(row => row.message.t === 'chan')).toBe(false);
        expect(lobby._debug.channels.get('#jam-fixture').jam.invitation).toBeUndefined();
        armed = false; refuse = false; await share(lobby, 'host', B);
        expect(results(messages)).toEqual([{ id: 'host', message: { t: 'jam-share-result', id: B, status: 'published' } }]);
    });
});
