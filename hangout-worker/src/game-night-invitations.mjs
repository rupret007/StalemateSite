import { GAME_INVITE_UNAVAILABLE, gameNightInvite, gameNightLabels, gameNightRoomName } from '../../r/45662413410ed051/lobby/game-night.mjs';
import { BETA_TTL, DEMO_INVITE_TTL } from './beta-auth.mjs';
import { arcadeRoomRequest } from './game-night-sockets.mjs';

export const GAME_GUEST_PATH = '/beta/game-night/guest';
export const GAME_INVITATION_PATH = '/beta/game-night/invitation';
const STORAGE_PREFIX = 'game-night-invitation:';
const CLAIM_TTL = 60_000;
const GUEST_TTL = 2 * 60 * 60_000;
const LINK_CAP = 100;
const LINK_CAP_PER_HOST = 8;
const codePattern = /^[a-f0-9]{32}$/;
const sidPattern = /^[a-z0-9-]{16,64}$/;
const randomCode = () => crypto.randomUUID().replaceAll('-', '');
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    byte => byte.toString(16).padStart(2, '0')).join('');
export const gameGuestSessionRef = sid => digest('game-guest-session:' + sid);
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
export { GAME_INVITE_UNAVAILABLE };
const unavailable = () => reply({ error: GAME_INVITE_UNAVAILABLE }, 410);

async function waitingGuestSeat(lobby, roomScope, game, match, hostSid) {
    if (!lobby.arcadeAvailable(game)) return false;
    return lobby.arcade.get(game).hasGuestSeat(roomScope, match, hostSid);
}

export function gameGuestEnabled(env) {
    return env.HANGOUT_BETA_MODE === 'protected' && env.HANGOUT_OPEN !== '0' && env.HANGOUT_GAME_NIGHT_GUESTS === '1';
}

export function gameGuestScope(value) {
    const game = gameNightInvite(value?.game, value?.match);
    if (!game || !gameNightRoomName(value.room) || !codePattern.test(value.ref || '') || !sidPattern.test(value.host || '')
        || !Number.isInteger(value.nameSeed) || value.nameSeed < 0 || value.nameSeed > 0xffffffff) return null;
    return { ...game, room: value.room, ref: value.ref, host: value.host, nameSeed: value.nameSeed };
}

// Called within the lobby's serialized event path. Only the Worker sends a trusted session for issuance.
export async function gameInvitationRequest(lobby, operation, body, session) {
    if (operation === 'release') {
        const scope = gameGuestScope(body.scope);
        if (!scope || !sidPattern.test(body.sid || '')) return reply({ ok: false }, 400);
        await lobby.arcade.get(scope.game).releaseGuestClaim(scope, body.sid);
        return reply({ ok: true });
    }
    if (!gameGuestEnabled(lobby.env)) return reply({ error: 'Game invitations are unavailable.' }, 404);
    const now = Date.now();
    const storage = lobby.state.storage;
    if (operation === 'issue') {
        const { actor, room, ref, game, match } = body;
        const scope = arcadeRoomRequest({ actor, room, ref });
        const host = scope && lobby.arcadeBinding(scope);
        const [nameSeed] = crypto.getRandomValues(new Uint32Array(1));
        const guest = gameGuestScope({ room, ref, game, match, host: host?.betaSid, nameSeed });
        if (!guest || !host.canOpen || !host.canPlay || host.gameGuest || session?.betaSid !== host.betaSid
            || !await lobby.sessionActive(host) || !await waitingGuestSeat(lobby, scope, game, match, host.betaSid)) {
            return reply({ error: 'Open a game table with an available seat before inviting a friend.' }, 403);
        }
        if (!await lobby.controlBudget.take(host.socket, actor)) return reply({ error: 'Game invitation allowance reached. Try again in a few minutes.' }, 429);
        const rows = await storage.list({ prefix: STORAGE_PREFIX, limit: LINK_CAP });
        const expired = [...rows].filter(([, record]) => record.until <= now).map(([key]) => key);
        if (expired.length) await storage.delete(expired);
        const hostCount = [...rows.values()].filter(record => record.until > now && record.scope.host === host.betaSid && !record.redeemer).length;
        if (rows.size - expired.length >= LINK_CAP || hostCount >= LINK_CAP_PER_HOST) {
            return reply({ error: 'Too many invitations are still on record. Share a current link for this game or try again later.' }, 429);
        }
        const demo = session.demo === true;
        const accessUntil = demo ? session.exp : null;
        if (demo && (!Number.isFinite(accessUntil) || accessUntil <= now)) return unavailable();
        const code = randomCode();
        const until = demo ? Math.min(now + DEMO_INVITE_TTL, accessUntil) : now + DEMO_INVITE_TTL;
        await storage.put(STORAGE_PREFIX + await digest(code), { scope: guest, until, version: host.betaInviteVersion,
            ...(demo ? { demo, accessUntil } : {}) });
        return reply({ code, until });
    }

    if (!['details', 'accept'].includes(operation) || !codePattern.test(body.code || '')
        || operation === 'accept' && (body.age13 !== true || !codePattern.test(body.attempt || ''))) {
        return reply({ error: 'Open the original invitation and confirm the age and house rules to join.' }, 400);
    }
    const key = STORAGE_PREFIX + await digest(body.code);
    const record = await storage.get(key);
    if (!record || record.until <= now || record.version !== String(lobby.env.HANGOUT_BETA_INVITE_VERSION || '1')) return unavailable();
    const scope = gameGuestScope(record.scope);
    if (!scope) return unavailable();
    const attempt = operation === 'accept' ? await digest(body.attempt) : null;
    if (record.redeemer && record.redeemer !== attempt) return unavailable();
    if (record.redeemer) return record.exp > now ? reply({ scope: record.scope, sid: record.sid, exp: record.exp }) : unavailable();

    const actor = lobby.engine.invitedGameHost(scope);
    const binding = actor && lobby.arcadeBinding({ actor, room: scope.room, ref: scope.ref });
    if (!binding?.canPlay || !await lobby.sessionActive(binding)) return unavailable();
    const table = lobby.arcade.get(scope.game);
    if (!table || !lobby.arcadeAvailable(scope.game)) return unavailable();
    if (operation === 'details') {
        if (!await waitingGuestSeat(lobby, scope, scope.game, scope.match, scope.host)) return unavailable();
        return reply({ game: gameNightLabels[scope.game], host: binding.nick });
    }
    const sid = crypto.randomUUID();
    const exp = record.accessUntil !== undefined ? Math.min(now + BETA_TTL, record.accessUntil)
        : record.demo ? Math.min(now + GUEST_TTL, record.until) : now + GUEST_TTL;
    const accepted = { ...record, sid, exp, redeemer: attempt };
    if (!await table.reserveGuestSeat(scope, sid, Math.min(now + CLAIM_TTL, exp), key, accepted)) return unavailable();
    return reply({ scope, sid, exp });
}
