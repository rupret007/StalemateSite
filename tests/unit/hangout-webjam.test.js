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
