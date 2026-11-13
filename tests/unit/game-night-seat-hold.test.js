import { describe, expect, it } from 'vitest';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';

function room() {
    let clock = 1_800_000_000_000;
    const inbox = new Map();
    let n = 0;
    const lobby = createLobby({
        gameNight: true,
        now: () => clock,
        send: (id, message) => { if (!inbox.has(id)) inbox.set(id, []); inbox.get(id).push(message); }
    });
    const board = person => (inbox.get(person.id) || []).findLast(message => message.t === 'four')?.game;
    function person(nick, dev, betaSid) {
        const id = `c${n += 1}`;
        const joined = lobby.connect({ id, dev, iph: `ip-${dev}`, role: 'fan', betaSid });
        if (!joined.ok) throw new Error(joined.reason || 'connect failed');
        lobby.message(id, JSON.stringify({ t: 'hello', nick, age13: true }));
        return { id, nick };
    }
    const say = (person, name, args, channel, roomInstance) => {
        clock += 2000;
        return lobby.message(person.id, JSON.stringify({ t: 'cmd', name, args, ch: channel, ...(roomInstance ? { roomInstance } : {}), ...(['invite', 'kick'].includes(name) ? { personNamed: true } : {}) }));
    };
    return { lobby, board, person, say, advance: ms => { clock += ms; } };
}

describe('Four in a Row seat hold', () => {
    it('gives a reloaded phone its seat back, then clears the board', () => {
        const { lobby, board, person, say, advance } = room();
        const host = person('GameHost', 'dev-host', 'sid-host');
        const guest = person('GameGuest', 'dev-guest', 'sid-guest');
        const channel = '#game-1acbefx23acbe';
        say(host, 'join', [channel]);
        const ref = lobby._debug.channels.get(channel).keepRef;
        say(host, 'invite', [guest.nick], channel);
        say(guest, 'join', [channel]);
        say(host, 'four', ['open', ''], channel, ref);
        const id = board(host).id;
        say(guest, 'four', ['join', id], channel, ref);
        expect(board(host)).toMatchObject({ id, host: host.id, guest: guest.id });
        lobby.disconnect(guest.id);
        expect(board(host)).toMatchObject({ id, guest: guest.id });
        const returned = person('GameGuest', 'dev-guest', 'sid-guest');
        say(returned, 'join', [channel]);
        expect(board(host)).toMatchObject({ id, guest: returned.id });
        lobby.disconnect(returned.id);
        advance(74_999);
        lobby.tick();
        expect(board(host)).toMatchObject({ id, guest: returned.id });
        advance(1);
        lobby.tick();
        expect(board(host)).toBeNull();
    });

    function seated(channel) {
        const kit = room();
        const host = kit.person('GameHost', 'dev-host', 'sid-host');
        const guest = kit.person('GameGuest', 'dev-guest', 'sid-guest');
        kit.say(host, 'join', [channel]);
        const ref = kit.lobby._debug.channels.get(channel).keepRef;
        kit.say(host, 'invite', [guest.nick], channel);
        kit.say(guest, 'join', [channel]);
        kit.say(host, 'four', ['open', ''], channel, ref);
        const id = kit.board(host).id;
        kit.say(guest, 'four', ['join', id], channel, ref);
        return { ...kit, host, guest, ref, id };
    }

    it('does not give a held seat to another phone or another session', () => {
        const channel = '#game-1acbefx23acbe';
        const { lobby, board, person, say, host, guest, ref, id, advance } = seated(channel);
        lobby.disconnect(guest.id);
        // Same session on a different device, and the same device on a different session.
        const otherPhone = person('OtherPhone', 'dev-other', 'sid-guest');
        const otherSession = person('OtherSession', 'dev-guest', 'sid-other');
        for (const visitor of [otherPhone, otherSession]) {
            say(host, 'invite', [visitor.nick], channel);
            say(visitor, 'join', [channel]);
            expect(lobby._debug.channels.get(channel).members.has(visitor.id)).toBe(true);
            expect(board(host)).toMatchObject({ id, guest: guest.id });
            say(visitor, 'four', ['join', id], channel, ref);
            say(visitor, 'four', ['drop', id, '0', '1'], channel, ref);
            say(visitor, 'four', ['drop', id, '1', '1'], channel, ref);
        }
        expect(board(host)).toMatchObject({ id, guest: guest.id, moves: 0 });
        advance(75_000);
        lobby.tick();
        expect(board(host)).toBeNull();
    });

    it('lets the player still in the room end a held board instead of waiting', () => {
        const channel = '#game-1acbefx23acbe';
        const { lobby, board, say, host, guest, ref, id } = seated(channel);
        lobby.disconnect(guest.id);
        expect(board(host)).toMatchObject({ id, guest: guest.id });
        say(host, 'four', ['leave', id], channel, ref);
        expect(board(host)).toBeNull();
        expect(lobby._debug.channels.get(channel).fourHolds).toBeNull();
    });

    it('ends the board at once when a seated player is kicked', () => {
        const channel = '#game-1acbefx23acbe';
        const { lobby, board, say, host, guest, id } = seated(channel);
        expect(board(host)).toMatchObject({ id, guest: guest.id });
        say(host, 'kick', [guest.nick], channel);
        expect(lobby._debug.channels.get(channel).members.has(guest.id)).toBe(false);
        expect(board(host)).toBeNull();
    });

    it('ends the board at once when the dropped player has no signed-in session to match', () => {
        const { lobby, board, person, say } = room();
        const host = person('GameHost', 'dev-host', 'sid-host');
        const guest = person('GameGuest', 'dev-guest', undefined);
        const channel = '#game-1acbefx23acbe';
        say(host, 'join', [channel]);
        const ref = lobby._debug.channels.get(channel).keepRef;
        say(host, 'invite', [guest.nick], channel);
        say(guest, 'join', [channel]);
        say(host, 'four', ['open', ''], channel, ref);
        say(guest, 'four', ['join', board(host).id], channel, ref);
        expect(board(host)).toMatchObject({ guest: guest.id });
        lobby.disconnect(guest.id);
        expect(board(host)).toBeNull();
    });

    it('ends the board when the host leaves the table or a player leaves the room', () => {
        const { lobby, board, person, say } = room();
        const host = person('GameHost', 'dev-host', 'sid-host');
        const guest = person('GameGuest', 'dev-guest', 'sid-guest');
        const channel = '#game-9cde12x9df823';
        say(host, 'join', [channel]);
        const ref = lobby._debug.channels.get(channel).keepRef;
        say(host, 'invite', [guest.nick], channel);
        say(guest, 'join', [channel]);
        say(host, 'four', ['open', ''], channel, ref);
        const id = board(host).id;
        say(guest, 'four', ['join', id], channel, ref);
        say(host, 'four', ['leave', id], channel, ref);
        expect(board(guest)).toBeNull();
        say(host, 'four', ['open', ''], channel, ref);
        const next = board(host).id;
        say(guest, 'four', ['join', next], channel, ref);
        say(guest, 'part', [channel], channel);
        expect(board(host)).toBeNull();
    });
});
