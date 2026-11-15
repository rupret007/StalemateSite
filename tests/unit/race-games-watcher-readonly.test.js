// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { TurdRushRace, TURD_RUSH_RACE_VERSION, RUSH_COUNTDOWN_MS } from '../../hangout-worker/arcade/games/turdrush-race.js';
import { TurdtrisMatch, TURDTRIS_MATCH_VERSION, SPRINT_COUNTDOWN_MS } from '../../hangout-worker/arcade/games/turdtris-match.js';
import { ARCADE_TAG, createArcadeTransport } from '../../hangout-worker/src/arcade-transport.mjs';

const matchId = 'race-12345';

describe('race games keep watchers read-only', () => {
    it('refuses Turd Rush input after its countdown', () => {
        const now = 1000;
        const match = new TurdRushRace(matchId, now, null, 1);
        const at = now + RUSH_COUNTDOWN_MS;

        expect(match.command(null, { id: matchId, version: TURD_RUSH_RACE_VERSION, action: 'input', sequence: 1,
            inputs: [[1, 'left']] }, at)).toMatchObject({ ok: false, reason: 'unavailable' });
    });

    it('refuses Turdtris input after its countdown and gives a spectator no seat input state', () => {
        const now = 1000;
        const match = new TurdtrisMatch(matchId, now, null, 1);
        const at = now + SPRINT_COUNTDOWN_MS;

        expect(match.command(null, { id: matchId, version: TURDTRIS_MATCH_VERSION, action: 'input', sequence: 1,
            inputs: ['left'] }, at)).toMatchObject({ ok: false, reason: 'unavailable' });
        const spectator = match.view(null, at);
        expect(spectator.self).toBeNull();
        expect(JSON.stringify(spectator)).not.toMatch(/"(?:sequence|queue|credits|pace)"/);
    });

    it('refuses a watch-only Turdtris transport input after countdown and sends no seat sequence', async () => {
        const records = new Map(), actors = new Map(), sockets = [];
        let now = 1000, serial = 0;
        const storage = {
            getAlarm: async () => null, setAlarm: async () => {},
            get: async key => structuredClone(records.get(key)),
            put: async (key, value) => records.set(key, structuredClone(value)),
            delete: async key => records.delete(key),
            list: async ({ prefix = '' } = {}) => new Map([...records].filter(([key]) => key.startsWith(prefix)))
        };
        const room = '#game-2ca9e1x1be34a', ref = '0'.repeat(32);
        function connect(id, betaSid, canOpen, watch = false) {
            const binding = { betaSid, betaInviteVersion: 1, canPlay: true, canOpen,
                gameGuest: watch ? { room, ref, host: 'seat-host', match: matchId, game: 'turdtris', watch: true } : null,
                canJoin: () => true, canSee: () => true };
            actors.set(id, binding);
            let attachment = { actor: id, betaSid, betaInviteVersion: 1, room, ref,
                kind: ARCADE_TAG + ':turdtris' };
            const socket = { frames: [], readyState: 1,
                serializeAttachment: value => { attachment = value; }, deserializeAttachment: () => attachment,
                send(value) { this.frames.push(JSON.parse(value)); }, close: vi.fn() };
            sockets.push(socket);
            return socket;
        }
        const host = connect('host-actor', 'seat-host', true);
        const player = connect('player-actor', 'seat-player', false);
        const watcher = connect('watch-actor', 'seat-watch', false, true);
        const transport = createArcadeTransport({
            state: { storage, getWebSockets: () => sockets }, name: 'turdtris',
            current: scope => actors.get(scope.actor), active: async () => true, approve: async () => true,
            charge: async () => true, allowed: () => true, now: () => now,
            uuid: () => 'race-' + String(++serial).padStart(5, '0')
        });
        const send = (socket, action, fields = {}) => transport.receive(socket,
            JSON.stringify({ version: 1, action, ...fields }));

        await send(host, 'open');
        await send(player, 'join', { id: host.frames.at(-1).state.id });
        const id = watcher.frames.at(-1).state.id;
        await send(watcher, undefined, { t: 'hello', lastSeq: 0 });
        const spectatorSnapshot = watcher.frames.at(-1);
        now += SPRINT_COUNTDOWN_MS;
        const before = watcher.frames.length;
        await send(watcher, 'input', { id, sequence: 1, inputs: ['left'] });

        expect(watcher.frames.slice(before).at(-1)).toMatchObject({ t: 'match-error', reason: 'unavailable' });
        const delivered = JSON.stringify(watcher.frames);
        expect(delivered).not.toMatch(/"(?:sequence|queue|credits|pace)"/);
        expect(spectatorSnapshot.state).toMatchObject({ watchOnly: true, seat: null, match: { self: null } });
    });
});
