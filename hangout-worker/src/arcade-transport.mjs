import { GameNightChess } from './game-night-chess.mjs';
import { GameNightCrapeights } from './game-night-crapeights.mjs';
import { GameNightTurdRummy } from './game-night-turdrummy.mjs';
import { GameNightTurdSpades, GameNightSpadesPartners } from './game-night-turdspades.mjs';
import { GameNightTurdJack } from './game-night-turdjack.mjs';
import { GameNightTurdtris } from './game-night-turdtris.mjs';
import { GameNightTurdomania } from './game-night-turdomania.mjs';
import { GameNightTurdRush } from './game-night-turdrush.mjs';
import { GameNightTurdanoid } from './game-night-turdanoid.mjs';
import { createGameNightSockets } from './game-night-sockets.mjs';
export { arcadeRoomRequest } from './game-night-sockets.mjs';

export const ARCADE_TAG = 'game-night-match';
export const ARCADE_PROTOCOL = 'game-night.v1';
const MATCH_TTL = 40 * 60000;
const CONNECTED_CLAIM_TTL = 60_000;
const MATCH_CAP = 60;
const adapters = new Map([
    ['chess', { flag: 'HANGOUT_ARCADE_CHESS', Table: GameNightChess }],
    ['crapeights', { flag: 'HANGOUT_ARCADE_CRAPEIGHTS', Table: GameNightCrapeights, renewOnAction: true }],
    ['turdrummy', { flag: 'HANGOUT_ARCADE_TURDRUMMY', Table: GameNightTurdRummy, renewOnAction: true }],
    ['turdspades', { flag: 'HANGOUT_ARCADE_TURDSPADES', Table: GameNightTurdSpades, PartnerTable: GameNightSpadesPartners, renewOnAction: true }],
    ['turdjack', { flag: 'HANGOUT_ARCADE_TURDJACK', Table: GameNightTurdJack, renewOnAction: true }],
    ['turdtris', { flag: 'HANGOUT_ARCADE_TURDTRIS', Table: GameNightTurdtris, tableCap: 4 }],
    ['turdomania', { flag: 'HANGOUT_ARCADE_TURDOMANIA', Table: GameNightTurdomania, tableCap: 8 }],
    ['turdrush', { flag: 'HANGOUT_ARCADE_TURDRUSH', Table: GameNightTurdRush, tableCap: 4 }],
    ['turdanoid', { flag: 'HANGOUT_ARCADE_TURDANOID', Table: GameNightTurdanoid, tableCap: 4 }]
]);

export const arcadeGames = Object.freeze([...adapters.keys()]);
const tagFor = game => game === 'chess' ? ARCADE_TAG : ARCADE_TAG + ':' + game;
const gamesByTag = new Map(arcadeGames.map(game => [tagFor(game), game]));
export const arcadeSocketGame = socket => gamesByTag.get(socket.deserializeAttachment?.()?.kind);
export const isArcadeSocket = socket => !!arcadeSocketGame(socket);
const gamesByPath = new Map(arcadeGames.flatMap(game => {
    const prefix = game === 'chess' ? '/beta/arcade' : '/beta/arcade-' + game;
    return [[prefix + '-ticket', game], [prefix + '-match', game]];
}));
export const arcadeGame = path => gamesByPath.get(path);
export const arcadePath = path => gamesByPath.has(path);
export function arcadeEnabled(env = {}, game) {
    if (env.HANGOUT_BETA_MODE !== 'protected' || env.HANGOUT_OPEN === '0') return false;
    return game ? env[adapters.get(game)?.flag] === '1' : arcadeGames.some(name => arcadeEnabled(env, name));
}

// Call from the same Durable Object's serialized lobby event path. The
// callbacks resolve membership and participation against the committed lobby.
export function createArcadeTransport({ state, current, active, approve, charge, allowed, name = 'chess', now = () => Date.now(), uuid = () => crypto.randomUUID() }) {
    const { Table, PartnerTable, renewOnAction, tableCap = MATCH_CAP } = adapters.get(name);
    const tag = tagFor(name), prefix = name === 'chess' ? ARCADE_TAG + ':' : 'game-night-' + name + ':';
    const pendingRevocations = new Map();
    const { issue, upgrade, member, sockets, send, close } = createGameNightSockets({
        state, current, active, charge, now, uuid, tag, protocol: ARCADE_PROTOCOL,
        readyType: 'match-ready', allowed: scope => !pendingRevocations.has(scope?.ref) && allowed()
    });
    const key = scope => prefix + scope.ref;
    const restore = record => (record.mode === 'partners' && PartnerTable ? PartnerTable : Table).restore(record);
    const liveClaims = (claims, time) => (claims || []).filter(claim => claim.until > time);
    function savedRecord(scope, game, expiresAt, claims) {
        return { room: scope.room, expiresAt, [name]: game.checkpoint(), ...(claims.length ? { claims } : {}) };
    }
    async function load(scope) {
        const record = await state.storage.get(key(scope));
        if (!record || record.room !== scope.room) return null;
        const time = now();
        if (record.expiresAt <= time) { await state.storage.delete(key(scope)); return null; }
        return { expiresAt: record.expiresAt, game: restore(record[name]), claims: liveClaims(record.claims, time) };
    }
    async function hasGuestSeat(scope, match, host) {
        const record = await load(scope);
        return !!record?.game.hasGuestSeat(match, host, record.claims.length);
    }
    async function reserveGuestSeat(scope, sid, until, invitationKey, accepted) {
        const record = await load(scope);
        if (!record?.game.hasGuestSeat(scope.match, scope.host, record.claims.length)) return false;
        const claims = [...record.claims, { sid, until }];
        // Commit the invitation redemption and its temporary seat together.
        await state.storage.put({
            [key(scope)]: savedRecord(scope, record.game, record.expiresAt, claims),
            [invitationKey]: accepted
        });
        publish(scope, record.game, null, claims);
        return true;
    }
    async function releaseGuestClaim(scope, sid) {
        const record = await load(scope);
        if (!record || !record.claims.some(claim => claim.sid === sid)) return;
        const claims = record.claims.filter(claim => claim.sid !== sid);
        await state.storage.put(key(scope), savedRecord(scope, record.game, record.expiresAt, claims));
        publish(scope, record.game, null, claims);
    }
    async function grantTable(scope) {
        const record = await load(scope);
        if (!record || record.game.subjects[0] !== scope.host) return null;
        const view = record.game.view(scope.host, now());
        return view.id === scope.match ? { ...record, view } : null;
    }
    const roomGrants = {
        atomic: true,
        async status(scope) {
            const record = await grantTable(scope);
            if (!record) return null;
            return { host: scope.host, hostSeat: record.view.seat, waiting: record.view.waiting,
                free: record.game.guestSeats(scope.match, scope.host).length };
        },
        async hold(scope, { holder, until, write }) {
            const record = await grantTable(scope);
            if (!record?.game.hasGuestSeat(scope.match, scope.host, record.claims.length)) return false;
            const seat = record.game.guestSeats(scope.match, scope.host)
                .find(side => !record.claims.some(claim => claim.seat === side));
            if (!seat) return false;
            const claims = [...record.claims, { sid: holder, until, seat, grant: true }];
            await state.storage.put({ ...write, [key(scope)]: savedRecord(scope, record.game, record.expiresAt, claims) });
            publish(scope, record.game, null, claims);
            return true;
        },
        async seat(scope, { subject, holder, until, write }) {
            const record = await grantTable(scope);
            const held = record?.claims.find(claim => claim.grant && claim.sid === holder);
            if (!held || !record.game.guestSeats(scope.match, scope.host).includes(held.seat)) return null;
            const claims = record.claims.map(claim => claim === held ? { sid: subject, until, seat: held.seat } : claim);
            await state.storage.put({ ...write, [key(scope)]: savedRecord(scope, record.game, record.expiresAt, claims) });
            publish(scope, record.game, null, claims);
            return held.seat;
        },
        async releaseHold(scope, holder) {
            const record = await grantTable(scope);
            if (record?.claims.some(claim => claim.grant && claim.sid === holder)) await releaseGuestClaim(scope, holder);
        }
    };
    function publish(scope, game, requester = null, claims = []) {
        for (const socket of requester ? [requester] : sockets()) {
            const recipient = socket.deserializeAttachment();
            if (recipient?.ref !== scope.ref || recipient.room !== scope.room) continue;
            const binding = member(recipient);
            if (!binding) { close(socket, 4403, 'room membership ended'); continue; }
            const subjects = game?.subjects ?? [];
            const permitted = subjects.every(subject => binding.canSee(subject));
            try { socket.serializeAttachment({ ...recipient, subjects: permitted ? subjects : [] }); }
            catch { close(socket, 1011, 'match connection unavailable'); continue; }
            const view = permitted && game ? game.view(binding.betaSid, now()) : null;
            if (view?.waiting && claims.length) {
                const reserved = claims.some(claim => claim.sid === binding.betaSid);
                view.hasOpenSeat = reserved || game.hasGuestSeat(view.id, subjects[0], claims.length);
                if (view.canStart) view.canStart = false;
                if (binding.canOpen && view.seat) view.pendingGuestMs = Math.max(1, Math.min(...claims.map(claim => claim.until)) - now());
            }
            send(socket, { t: 'match-state', version: 1, room: recipient.room,
                state: view, canOpen: binding.canOpen,
                ...(PartnerTable ? { partners: true } : {}) });
        }
    }
    async function receive(socket, raw) {
        if (socket.readyState !== 1) return;
        const scope = socket.deserializeAttachment();
        const binding = member(scope);
        if (!binding || !await active(binding)) return close(socket, 4403, 'room membership ended');
        if (!await charge(socket, scope.actor)) return close(socket, 4429, 'match allowance exhausted');
        if (typeof raw !== 'string' || raw.length > 768) return close(socket, 4400, 'bad match frame');
        let frame;
        try { frame = JSON.parse(raw); } catch { return close(socket, 4400, 'bad match frame'); }
        if (frame?.version !== 1 || typeof frame.action !== 'string') return close(socket, 4400, 'bad match frame');
        try {
            const record = await load(scope);
            let game = record?.game;
            const subject = binding.betaSid;
            let claims = record?.claims || [];
            if (game && !game.subjects.every(peer => binding.canSee(peer))) {
                return send(socket, { t: 'match-error', reason: 'unavailable' });
            }
            let changed = game?.expire(now()) || false;
            const resume = frame.action === 'sync' && game?.seat(subject) && !scope.synced;
            let expiresAt = record?.expiresAt;
            let error = '';
            if (frame.action !== 'sync') {
                if (!binding.canPlay || !await approve(scope.actor)) error = 'unavailable';
                else if (frame.action === 'open') {
                    const SelectedTable = frame.mode === undefined ? Table : frame.mode === 'partners' ? PartnerTable : null;
                    if (!binding.canOpen || game || !SelectedTable) error = 'unavailable';
                    else if ((await state.storage.list({ prefix, limit: tableCap })).size >= tableCap) error = 'unavailable';
                    else { game = new SelectedTable(uuid(), subject); changed = true; expiresAt = now() + MATCH_TTL; }
                } else if (!game) error = 'match-changed';
                else if (frame.action === 'join') {
                    const otherClaims = claims.filter(claim => claim.sid !== subject);
                    const held = claims.find(claim => claim.sid === subject);
                    const heldSeats = otherClaims.flatMap(claim => claim.seat ? [claim.seat] : []);
                    const seat = held?.seat ?? frame.seat;
                    if (binding.gameGuest && binding.gameGuest.match !== frame.id ||
                        !game.subjects.every(peer => binding.canJoin(peer)) ||
                        !game.join(subject, frame.id, now(), seat, otherClaims.length, heldSeats)) error = 'seat-unavailable';
                    else { claims = otherClaims; changed = true; expiresAt = now() + MATCH_TTL; }
                } else if (frame.action === 'start') {
                    if (claims.length || !binding.canOpen || !game.start(subject, frame.id, now())) error = 'start-unavailable';
                    else { changed = true; expiresAt = now() + MATCH_TTL; }
                } else if (frame.action === 'leave') {
                    if (!game.seat(subject) || game.view(subject, now()).id !== frame.id) error = 'match-changed';
                    else {
                        if (!game.releaseSeat(subject)) game = null;
                        changed = true;
                    }
                } else if (frame.action === 'rematch') {
                    if (!game.requestRematch(subject, frame.id, uuid(), now())) error = 'rematch-unavailable';
                    else { changed = true; expiresAt = now() + MATCH_TTL; }
                } else {
                    const outcome = game.command(subject, frame, now());
                    changed ||= outcome.ok || outcome.changed === true;
                    if (!outcome.ok) error = outcome.reason;
                    else if (renewOnAction) expiresAt = now() + MATCH_TTL;
                }
            }
            if (frame.action === 'sync' && !scope.synced) {
                const claim = claims.find(entry => entry.sid === subject && !entry.connected);
                if (claim && binding.gameGuest?.game === name &&
                    game.hasGuestSeat(binding.gameGuest.match, binding.gameGuest.host, claims.length - 1)) {
                    claim.connected = true;
                    claim.until = Math.max(claim.until, now() + CONNECTED_CLAIM_TTL);
                    changed = true;
                }
            }
            if (changed) {
                if (game) await state.storage.put(key(scope), savedRecord(scope, game, expiresAt, claims));
                else await state.storage.delete(key(scope));
                publish(scope, game, null, claims);
            } else publish(scope, game, resume ? null : socket, claims);
            if (frame.action === 'sync' && !scope.synced) {
                socket.serializeAttachment({ ...socket.deserializeAttachment(), synced: true });
            }
            if (error) send(socket, { t: 'match-error', reason: error });
        } catch {
            send(socket, { t: 'match-error', reason: 'storage-unavailable' });
        }
    }
    function reconcile() {
        for (const ws of sockets()) {
            const scope = ws.deserializeAttachment(), binding = member(scope);
            if (!binding) close(ws, 4403, 'room membership ended');
            else if (scope.subjects?.some(subject => !binding.canSee(subject))) {
                try { ws.serializeAttachment({ ...scope, subjects: [] }); }
                catch { close(ws, 1011, 'match connection unavailable'); continue; }
                send(ws, { t: 'match-state', version: 1, room: scope.room, state: null, canOpen: false });
            }
        }
    }
    async function revoke(scope, subject) {
        const pending = pendingRevocations.get(scope.ref) ?? new Set();
        pending.add(subject);
        pendingRevocations.set(scope.ref, pending);
        try {
            const record = await load(scope);
            const game = record?.game, occupied = !!game?.seat(subject);
            const claims = record?.claims.filter(claim => claim.sid !== subject) || [];
            const released = !!record && claims.length < record.claims.length;
            let remaining = null;
            if (occupied) {
                if (game.releaseSeat(subject)) {
                    remaining = game;
                    await state.storage.put(key(scope), savedRecord(scope, game, record.expiresAt, claims));
                } else await state.storage.delete(key(scope));
            }
            if (!occupied && released) {
                remaining = game;
                await state.storage.put(key(scope), savedRecord(scope, game, record.expiresAt, claims));
            }
            pending.delete(subject);
            if (!pending.size) pendingRevocations.delete(scope.ref);
            if (occupied || released) publish(scope, remaining, null, claims);
            return true;
        } catch {
            for (const ws of sockets()) if (ws.deserializeAttachment()?.ref === scope.ref) close(ws, 1011, 'match storage unavailable');
            return false;
        }
    }
    async function maintain() {
        reconcile();
        const records = await state.storage.list({ prefix, limit: MATCH_CAP });
        for (const [storageKey, record] of records) {
            const scope = { room: record.room, ref: storageKey.slice(prefix.length) };
            if (record.expiresAt <= now()) {
                await state.storage.delete(storageKey);
                publish(scope, null);
            } else {
                const game = restore(record[name]);
                const time = now(), claims = liveClaims(record.claims, time);
                const expiredClaim = claims.length < (record.claims?.length || 0);
                if (!game.expire(time) && !expiredClaim) continue;
                await state.storage.put(storageKey, savedRecord(scope, game, record.expiresAt, claims));
                publish(scope, game, null, claims);
            }
        }
    }
    async function retireDisabled() {
        const records = await state.storage.list({ prefix, limit: MATCH_CAP });
        if (records.size) await state.storage.delete([...records.keys()]);
    }
    return { issue, upgrade, receive, reconcile, revoke, maintain, retireDisabled, hasGuestSeat, reserveGuestSeat, releaseGuestClaim, roomGrants };
}
