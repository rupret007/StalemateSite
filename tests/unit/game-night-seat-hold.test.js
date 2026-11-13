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
        return lobby.message(person.id, JSON.stringify({ t: 'cmd', name, args, ch: channel, ...(roomInstance ? { roomInstance } : {}), ...(name === 'invite' ? { personNamed: true } : {}) }));
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
