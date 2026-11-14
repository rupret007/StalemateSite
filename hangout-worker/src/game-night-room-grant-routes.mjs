import { gameGuestEnabled, gameGuestScope } from './game-night-invitations.mjs';
import { createRoomGrants, grantResponse } from './game-night-room-grants.mjs';
import { arcadeRoomRequest } from './game-night-sockets.mjs';

export const GAME_ROOM_GRANT_PATH = '/beta/game-night/room-grant';
export const gameRoomGrantsEnabled = env => gameGuestEnabled(env) && env.HANGOUT_GAME_NIGHT_ROOM_GRANTS === '1';

const reply = (error, status) => Response.json({ error }, { status });
const unavailable = () => reply('Open a game table with an available seat before seating your room.', 403);

export function lobbyRoomGrants(lobby) {
    const transport = scope => lobby.arcade.get(scope.game)?.roomGrants;
    const table = {
        atomic: true,
        async status(scope) {
            if (!lobby.arcadeAvailable(scope.game)) return null;
            const actor = lobby.engine.invitedGameHost(scope);
            const host = actor && lobby.arcadeBinding({ ...scope, actor }, scope.game);
            if (!host?.canPlay || !await lobby.sessionActive(host)) return null;
            return transport(scope)?.status(scope);
        },
        hold: (scope, claim) => transport(scope).hold(scope, claim),
        seat: (scope, claim) => transport(scope).seat(scope, claim),
        releaseHold: (scope, holder) => transport(scope)?.releaseHold(scope, holder)
    };
    const grants = createRoomGrants({ storage: lobby.state.storage, table });

    async function request(operation, body, session) {
        if (!gameRoomGrantsEnabled(lobby.env)) return reply('Game invitations are unavailable.', 404);
        const now = Date.now();
        const version = String(lobby.env.HANGOUT_BETA_INVITE_VERSION || '1');
        if (operation === 'redeem') {
            return grantResponse(await grants.redeemGrant({ value: body.value, attempt: body.attempt,
                subject: session?.betaSid ?? null, now, version }));
        }
        if (operation !== 'register') return reply('Game invitations are unavailable.', 404);

        const { actor, room, ref, game, match, hashes } = body;
        const guest = gameGuestScope({ room, ref, game, match, host: session?.betaSid, nameSeed: 0 }, true);
        const scope = guest && arcadeRoomRequest({ actor, room, ref });
        const host = scope && lobby.arcadeBinding(scope, game);
        if (!host?.canOpen || !host.canPlay || host.gameGuest || host.betaSid !== session.betaSid ||
            !lobby.arcadeAvailable(game) || !await lobby.sessionActive(host)) return unavailable();
        if (!await lobby.controlBudget.take(host.socket, actor)) {
            return reply('Game invitation allowance reached. Try again in a few minutes.', 429);
        }
        return grantResponse(await grants.registerGrants({ room, game, match, hashes, ref, hostSubject: host.betaSid, now, version, recover: body.recover === true }));
    }

    return { request, sweep: grants.sweep };
}
