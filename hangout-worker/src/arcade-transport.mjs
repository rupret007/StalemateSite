import { GAME_NIGHT_LENGTH } from './game-night-lifetime.mjs';
import { gameNightPassRecord, readGameNightPass } from './game-night-pass.mjs';
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
const CONNECTED_CLAIM_TTL = 60_000;
const MATCH_CAP = 60;
const adapters = new Map([
    ['chess', { flag: 'HANGOUT_ARCADE_CHESS', Table: GameNightChess }],
    ['crapeights', { flag: 'HANGOUT_ARCADE_CRAPEIGHTS', Table: GameNightCrapeights }],
    ['turdrummy', { flag: 'HANGOUT_ARCADE_TURDRUMMY', Table: GameNightTurdRummy }],
    ['turdspades', { flag: 'HANGOUT_ARCADE_TURDSPADES', Table: GameNightTurdSpades, PartnerTable: GameNightSpadesPartners }],
    ['turdjack', { flag: 'HANGOUT_ARCADE_TURDJACK', Table: GameNightTurdJack }],
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
export function createArcadeTransport({ state, current, active, guestActivity = async () => {}, approve, charge, allowed, name = 'chess', now = () => Date.now(), uuid = () => crypto.randomUUID() }) {
    const { Table, PartnerTable, tableCap = MATCH_CAP } = adapters.get(name);
    const tag = tagFor(name), prefix = name === 'chess' ? ARCADE_TAG + ':' : 'game-night-' + name + ':';
    const pendingRevocations = new Map();
    const { issue, upgrade, member, sockets, send, close } = createGameNightSockets({
        state, current, active, charge, now, uuid, tag, protocol: ARCADE_PROTOCOL,
        readyType: 'match-ready', readyFeatures: { ping: true }, snapshots: true, replaceByPlayer: true,
        allowed: scope => !pendingRevocations.has(scope?.ref) && allowed()
    });
    const key = scope => prefix + scope.ref;
    const restore = record => (record.mode === 'partners' && PartnerTable ? PartnerTable : Table).restore(record);
    const liveClaims = (claims, time) => (claims || []).filter(claim => claim.until > time);
    async function scheduleTableAlarm(expiresAt, claims, afterAlarm = false) {
        if (typeof state.storage.getAlarm !== 'function') return;
        const due = Math.min(expiresAt, ...claims.map(claim => claim.until));
        const existing = await state.storage.getAlarm();
        if (!Number.isFinite(existing) || existing > due || afterAlarm && existing <= now()) await state.storage.setAlarm(due);
    }
    function savedRecord(scope, game, expiresAt, claims, seq) {
        return { room: scope.room, expiresAt, seq, [name]: game.checkpoint(), ...(claims.length ? { claims } : {}) };
    }
    async function expireTable(scope, seq) {
        await state.storage.delete(key(scope));
        publish(scope, null, null, [], seq + 1);
    }
    async function load(scope, reportExpiry = false) {
        const record = await state.storage.get(key(scope));
        if (!record || record.room !== scope.room) return null;
        const time = now();
        if (record.expiresAt <= time) {
            await expireTable(scope, record.seq ?? 0);
            // A socket command can skip its reply when the broadcast already sent the new view.
            return reportExpiry ? { expired: true } : null;
        }
        return { expiresAt: record.expiresAt, seq: record.seq ?? 0, game: restore(record[name]), claims: liveClaims(record.claims, time) };
    }
    async function guestTableId(scope, match, host) {
        const record = await load(scope);
        return record?.game.hasGuestSeat(match, host, record.claims.length) ? record.game.tableId : null;
    }
    async function hasGuestSeat(scope, match, host) {
        return !!await guestTableId(scope, match, host);
    }
    async function guestNightEndsAt(scope) {
        const record = await load(scope);
        return record && record.game.tableId === scope.tableId ? record.expiresAt : 0;
    }
    async function reserveGuestSeat(scope, sid, until, invitationKey, accepted, passHash) {
        const record = await load(scope);
        if (!record?.game.hasGuestSeat(scope.match, scope.host, record.claims.length) ||
            scope.tableId && scope.tableId !== record.game.tableId) return false;
        const claims = [...record.claims, { sid, until }];
        await scheduleTableAlarm(record.expiresAt, claims);
        // Commit the invitation redemption and its temporary seat together.
        await state.storage.put({
            [key(scope)]: savedRecord(scope, record.game, record.expiresAt, claims, record.seq + 1),
            [invitationKey]: accepted,
            ...gameNightPassRecord({ scope: accepted.scope ?? scope, sid, exp: accepted.exp }, passHash, accepted.version)
        });
        publish(scope, record.game, null, claims, record.seq + 1);
        return true;
    }
    async function releaseGuestClaim(scope, sid) {
        const record = await load(scope);
        if (!record || !record.claims.some(claim => claim.sid === sid)) return;
        const claims = record.claims.filter(claim => claim.sid !== sid);
        await state.storage.put(key(scope), savedRecord(scope, record.game, record.expiresAt, claims, record.seq + 1));
        publish(scope, record.game, null, claims, record.seq + 1);
    }
    async function grantTable(scope) {
        const record = await load(scope);
        if (!record || record.game.host !== scope.host) return null;
        const view = record.game.view(scope.host, now());
        return view.id === scope.match ? { ...record, view } : null;
    }
    const roomGrants = {
        atomic: true,
        async status(scope) {
            const record = await grantTable(scope);
            if (!record) return null;
            return { host: scope.host, hostSeat: record.view.seat, waiting: record.view.waiting,
                tableId: record.game.tableId, nightEndsAt: record.expiresAt, free: record.game.guestSeats(scope.match, scope.host).length };
        },
        async hold(scope, { holder, until, write }) {
            const record = await grantTable(scope);
            if (!record?.game.hasGuestSeat(scope.match, scope.host, record.claims.length)) return false;
            const seat = record.game.guestSeats(scope.match, scope.host)
                .find(side => !record.claims.some(claim => claim.seat === side));
            if (!seat) return false;
            const claims = [...record.claims, { sid: holder, until, seat, grant: true }];
            await scheduleTableAlarm(record.expiresAt, claims);
            await state.storage.put({ ...write, [key(scope)]: savedRecord(scope, record.game, record.expiresAt, claims, record.seq + 1) });
            publish(scope, record.game, null, claims, record.seq + 1);
            return true;
        },
        async seat(scope, { subject, holder, until, write }) {
            const record = await grantTable(scope);
            const held = record?.claims.find(claim => claim.grant && claim.sid === holder);
            if (!held || !record.game.guestSeats(scope.match, scope.host).includes(held.seat)) return null;
            const claims = record.claims.map(claim => claim === held ? { sid: subject, until, seat: held.seat } : claim);
            await scheduleTableAlarm(record.expiresAt, claims);
            await state.storage.put({ ...write, [key(scope)]: savedRecord(scope, record.game, record.expiresAt, claims, record.seq + 1) });
            publish(scope, record.game, null, claims, record.seq + 1);
            return held.seat;
        },
        async releaseHold(scope, holder) {
            const record = await grantTable(scope);
            if (record?.claims.some(claim => claim.grant && claim.sid === holder)) await releaseGuestClaim(scope, holder);
        }
    };
    function sendView(socket, attachment, view, canOpen, seq, seat = view?.seat ?? null) {
        const frame = { t: 'match-state', version: 1, room: attachment.room, state: view, canOpen,
            ...(PartnerTable ? { partners: true } : {}) };
        if (!attachment.snapshot) return send(socket, frame);
        const match = view?.match;
        return send(socket, { ...frame, t: 'snapshot', seq, phase: match?.result ? 'finished' : match ? 'playing' : 'lobby',
            currentMatchId: match?.id ?? null, yourSeat: seat,
            turn: match?.turn ?? match?.turnSeat ?? (name === 'turdjack' ? match?.active ?? null : null) });
    }
    function connectedPlayers(scope) {
        return new Set(sockets().flatMap(socket => {
            const attachment = socket.deserializeAttachment();
            return attachment.ref === scope.ref && attachment.room === scope.room && member(attachment)
                ? [attachment.betaSid] : [];
        }));
    }
    function canView(game, binding, scope) {
        const seated = !!game?.seat(binding.betaSid);
        const invitation = binding.gameGuest;
        if (game && invitation && (invitation.game !== name || invitation.room !== scope.room ||
            invitation.ref !== scope.ref || invitation.host !== game.host ||
            invitation.tableId && invitation.tableId !== game.tableId)) return false;
        return !game || game.subjects.every(subject =>
            binding.canSee(subject) || seated && binding.isPresent?.(subject) === false);
    }
    function publish(scope, game, requester, claims, seq, nextMatch) {
        const online = connectedPlayers(scope);
        for (const socket of requester ? [requester] : sockets()) {
            const recipient = socket.deserializeAttachment();
            if (recipient?.ref !== scope.ref || recipient.room !== scope.room) continue;
            const binding = member(recipient);
            if (!binding) { close(socket, 4403, 'room membership ended'); continue; }
            const subjects = game?.subjects ?? [];
            const permitted = canView(game, binding, recipient);
            const seat = permitted && game ? game.seat(binding.betaSid) : null;
            const view = permitted && game && !game.closed ? game.view(binding.betaSid, now()) : null;
            if (view?.seat) {
                view.disconnectedSeats = subjects.filter(subject => !online.has(subject)).map(subject => game.seat(subject));
                view.canStartRematch = game.host === binding.betaSid && binding.canOpen;
            }
            try { socket.serializeAttachment({ ...recipient, subjects: permitted ? subjects : [],
                playerId: binding.betaSid, seat, seq }); }
            catch { close(socket, 1011, 'match connection unavailable'); continue; }
            const invitation = binding.gameGuest;
            if (view?.waiting) {
                const reserved = claims.some(claim => claim.sid === binding.betaSid);
                const unreservedSeat = game.hasGuestSeat(view.id, game.host, claims.length);
                view.hasOpenSeat = reserved || unreservedSeat;
                if (invitation && unreservedSeat && !reserved && view.id !== invitation.match && invitation.game === name
                    && invitation.room === recipient.room && invitation.ref === recipient.ref && invitation.host === game.host) {
                    view.replacementAvailable = true;
                }
                if (claims.length) {
                    if (view.canStart) view.canStart = false;
                    if (binding.canOpen && view.seat) view.pendingGuestMs = Math.max(1, Math.min(...claims.map(claim => claim.until)) - now());
                }
            }
            if (view && nextMatch) send(socket, { t: 'rematch', matchId: nextMatch });
            sendView(socket, recipient, view, binding.canOpen, seq, seat);
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
        if (frame?.version === 1 && frame.action === 'ping') {
            if (Number.isSafeInteger(frame.nonce)) send(socket, { t: 'pong', nonce: frame.nonce });
            return;
        }
        try {
            if (frame?.version === 1 && frame.t === 'hello' && Number.isSafeInteger(frame.lastSeq) && frame.lastSeq >= 0) {
                if (frame.pass !== undefined) {
                    const pass = await readGameNightPass(state.storage, binding.gameGuest?.tableId, frame.pass);
                    if (!pass || pass.sid !== binding.betaSid || pass.exp <= now() || pass.version !== String(binding.betaInviteVersion)) {
                        return close(socket, 4403, 'table pass unavailable');
                    }
                }
                socket.serializeAttachment({ ...scope, snapshot: true });
                frame = { version: 1, action: 'sync' };
            }
            if (frame?.version !== 1 || typeof frame.action !== 'string') return close(socket, 4400, 'bad match frame');
            const record = await load(scope, true);
            let game = record?.game;
            const seq = record?.seq ?? 0;
            const subject = binding.betaSid;
            let claims = record?.claims || [];
            if (!canView(game, binding, scope)) {
                const attachment = socket.deserializeAttachment();
                if (frame.action === 'sync' && attachment.snapshot) {
                    socket.serializeAttachment({ ...attachment, subjects: [], playerId: subject, seat: null, seq });
                    sendView(socket, attachment, null, false, seq);
                    return;
                }
                return send(socket, { t: 'match-error', reason: 'unavailable' });
            }
            let changed = game?.expire(now()) || false;
            const resume = frame.action === 'sync' && game?.seat(subject) && !scope.synced;
            let expiresAt = record?.expiresAt;
            let error = '', nextMatch;
            if (frame.action !== 'sync') {
                if (!binding.canPlay || !await approve(scope.actor)) error = 'unavailable';
                else if (frame.action === 'open') {
                    const SelectedTable = frame.mode === undefined ? Table : frame.mode === 'partners' ? PartnerTable : null;
                    if (!binding.canOpen || !SelectedTable) error = 'unavailable';
                    else if (game?.closed && game.reopen(subject, uuid(), frame.mode, now())) {
                        claims = [];
                        changed = true;
                    } else if (game && !(game.closed && game.host === subject && game.subjects.length === 1)) error = 'unavailable';
                    else if (!game && (await state.storage.list({ prefix, limit: tableCap })).size >= tableCap) error = 'unavailable';
                    else { game = new SelectedTable(uuid(), subject, game?.tableId); changed = true; expiresAt ??= now() + GAME_NIGHT_LENGTH; }
                } else if (!game || game.closed) error = 'match-changed';
                else if (frame.action === 'join') {
                    const otherClaims = claims.filter(claim => claim.sid !== subject);
                    const held = claims.find(claim => claim.sid === subject);
                    const heldSeats = otherClaims.flatMap(claim => claim.seat ? [claim.seat] : []);
                    const seat = held?.seat ?? frame.seat;
                    const invitation = binding.gameGuest;
                    const invited = !invitation || invitation.game === name && invitation.room === scope.room && invitation.ref === scope.ref
                        && invitation.host === game.host && (invitation.match === frame.id || !held);
                    if (!invited) error = 'seat-unavailable';
                    else if (!game.seat(subject)) {
                        if (!game.subjects.every(peer => binding.canJoin(peer)) ||
                            !game.join(subject, frame.id, now(), seat, otherClaims.length, heldSeats)) error = 'seat-unavailable';
                        else { claims = otherClaims; changed = true; }
                    }
                } else if (frame.action === 'start') {
                    if (claims.length || !binding.canOpen || !game.start(subject, frame.id, now())) error = 'start-unavailable';
                    else { changed = true; }
                } else if (frame.action === 'leave') {
                    if (!game.seat(subject) || game.view(subject, now()).id !== frame.id) error = 'match-changed';
                    else {
                        if (binding.canOpen && game.close(subject, frame.id)) claims = [];
                        else if (!game.releaseSeat(subject)) game = null;
                        changed = true;
                    }
                } else if (frame.action === 'rematch' || frame.action === 'start-rematch') {
                    const force = frame.action === 'start-rematch';
                    const candidate = uuid();
                    if (force && !binding.canOpen ||
                        !game.requestRematch(subject, frame.id, candidate, now(), { connected: connectedPlayers(scope), force })) {
                        error = 'rematch-unavailable';
                    } else {
                        if (game.view(subject, now()).id === candidate) nextMatch = candidate;
                        changed = true;
                    }
                } else {
                    const outcome = game.command(subject, frame, now());
                    changed ||= outcome.ok || outcome.changed === true;
                    if (!outcome.ok) error = outcome.reason;
                }
            }
            if (frame.action === 'sync' && !scope.synced) {
                const claim = claims.find(entry => entry.sid === subject && !entry.connected);
                if (claim && binding.gameGuest?.game === name &&
                    game?.hasGuestSeat(binding.gameGuest.match, binding.gameGuest.host, claims.length - 1)) {
                    claim.connected = true;
                    claim.until = Math.min(expiresAt, Math.max(claim.until, now() + CONNECTED_CLAIM_TTL));
                    changed = true;
                }
            }
            if (!error && binding.gameGuest && game?.seat(subject) && frame.action !== 'sync') await guestActivity(binding);
            if (changed) {
                if (game) {
                    await scheduleTableAlarm(expiresAt, claims);
                    await state.storage.put(key(scope), savedRecord(scope, game, expiresAt, claims, seq + 1));
                } else await state.storage.delete(key(scope));
                publish(scope, game, null, claims, seq + 1, nextMatch);
            } else if (!record?.expired) publish(scope, game, resume ? null : socket, claims, seq);
            if (frame.action === 'sync' && !scope.synced) {
                socket.serializeAttachment({ ...socket.deserializeAttachment(), synced: true });
            }
            if (error) send(socket, { t: 'match-error', reason: error });
        } catch {
            send(socket, { t: 'match-error', reason: 'storage-unavailable' });
        }
    }
    async function presenceChanged(scope) {
        const playerId = scope?.playerId ?? scope?.betaSid;
        if (!playerId) return;
        const record = await load(scope);
        if (!record || record.game.closed || !record.game.seat(playerId)) return;
        const connected = connectedPlayers(scope);
        if (connected.has(playerId)) return;
        const matchId = uuid();
        if (record.game.startReadyRematch(matchId, now(), connected)) {
            const seq = record.seq + 1;
            await state.storage.put(key(scope), savedRecord(scope, record.game, record.expiresAt, record.claims, seq));
            publish(scope, record.game, null, record.claims, seq, matchId);
        } else publish(scope, record.game, null, record.claims, record.seq);
    }
    function reconcile() {
        for (const ws of sockets()) {
            const scope = ws.deserializeAttachment(), binding = member(scope);
            if (!binding) close(ws, 4403, 'room membership ended');
            else if (scope.subjects?.some(subject => !binding.canSee(subject) &&
                !(scope.seat && binding.isPresent?.(subject) === false))) {
                try { ws.serializeAttachment({ ...scope, subjects: [], seat: null }); }
                catch { close(ws, 1011, 'match connection unavailable'); continue; }
                sendView(ws, scope, null, false, scope.seq ?? 0);
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
                    await state.storage.put(key(scope), savedRecord(scope, game, record.expiresAt, claims, record.seq + 1));
                } else await state.storage.delete(key(scope));
            }
            if (!occupied && released) {
                remaining = game;
                await state.storage.put(key(scope), savedRecord(scope, game, record.expiresAt, claims, record.seq + 1));
            }
            pending.delete(subject);
            if (!pending.size) pendingRevocations.delete(scope.ref);
            if (occupied || released) publish(scope, remaining, null, claims, record.seq + 1);
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
                await expireTable(scope, record.seq ?? 0);
            } else {
                const game = restore(record[name]);
                const time = now(), claims = liveClaims(record.claims, time);
                await scheduleTableAlarm(record.expiresAt, claims, true);
                const expiredClaim = claims.length < (record.claims?.length || 0);
                if (!game.expire(time) && !expiredClaim) continue;
                await state.storage.put(storageKey, savedRecord(scope, game, record.expiresAt, claims, (record.seq ?? 0) + 1));
                publish(scope, game, null, claims, (record.seq ?? 0) + 1);
            }
        }
    }
    async function retireDisabled() {
        const records = await state.storage.list({ prefix, limit: MATCH_CAP });
        if (records.size) await state.storage.delete([...records.keys()]);
    }
    return { issue, upgrade, receive, reconcile, presenceChanged, revoke, maintain, retireDisabled, hasGuestSeat, guestTableId, guestNightEndsAt, reserveGuestSeat, releaseGuestClaim, roomGrants };
}
