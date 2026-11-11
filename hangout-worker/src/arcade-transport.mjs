import { GameNightChess } from './game-night-chess.mjs';

export const ARCADE_TAG = 'game-night-match';
export const ARCADE_PROTOCOL = 'game-night.v1';
const TICKET_PATH = '/beta/arcade-ticket';
const MATCH_PATH = '/beta/arcade-match';
const TICKET_TTL = 10000;
const MATCH_TTL = 40 * 60000;
const SOCKET_CAP = 60;
const MATCH_CAP = 60;
const PREFIX = 'game-night-match:';
const result = (value, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

export const arcadePath = path => path === TICKET_PATH || path === MATCH_PATH;
export const arcadeEnabled = (env = {}) => env.HANGOUT_BETA_MODE === 'protected' && env.HANGOUT_ARCADE_CHESS === '1' && env.HANGOUT_OPEN !== '0';
export const isArcadeSocket = socket => socket.deserializeAttachment?.()?.kind === ARCADE_TAG;

export function arcadeRoomRequest(body) {
    if (!body || Object.keys(body).length !== 3 ||
        !['actor', 'room', 'ref'].every(name => typeof body[name] === 'string') ||
        !/^c[a-f0-9]{32}$/.test(body.actor) || !/^#[a-z0-9-]{2,30}$/.test(body.room) ||
        !/^[a-f0-9]{32}$/.test(body.ref)) return null;
    return { actor: body.actor, room: body.room, ref: body.ref };
}

function sameSession(a, b) {
    return !!a?.betaSid && a.betaSid === b?.betaSid && a.betaInviteVersion === b.betaInviteVersion;
}

// Call from the same Durable Object's serialized lobby event path. The
// callbacks resolve membership and participation against the committed lobby.
export function createArcadeTransport({ state, current, active, approve, charge, allowed, now = () => Date.now(), uuid = () => crypto.randomUUID() }) {
    const tickets = new Map();
    const pendingRevocations = new Map();
    const sockets = () => state.getWebSockets(ARCADE_TAG).filter(ws => ws.readyState === 1 && isArcadeSocket(ws));
    const key = scope => PREFIX + scope.ref;
    function send(socket, frame) { try { socket.send(JSON.stringify(frame)); } catch { /* disconnected */ } }
    function close(socket, code, reason) {
        try { socket.serializeAttachment({ ...socket.deserializeAttachment(), retired: true }); } catch { /* disconnected */ }
        try { socket.close(code, reason); } catch { /* disconnected */ }
    }
    function member(scope) {
        const binding = !scope?.retired && !pendingRevocations.has(scope?.ref) && allowed() && current(scope);
        return binding && sameSession(scope, binding) ? binding : null;
    }
    function pruneTickets() {
        for (const [ticket, scope] of tickets) if (scope.until <= now() || !member(scope)) tickets.delete(ticket);
    }
    async function issue(scope, session) {
        const binding = current(scope);
        if (!allowed() || pendingRevocations.has(scope.ref) || !sameSession(binding, session) || !await active(binding)) {
            return result({ error: 'Room membership required.' }, 403);
        }
        pruneTickets();
        for (const [ticket, prior] of tickets) if (prior.actor === scope.actor) tickets.delete(ticket);
        if (tickets.size >= SOCKET_CAP || !await charge(binding.socket, scope.actor)) return result({ error: 'Match capacity unavailable.' }, 429);
        const ticket = 'm' + uuid().replaceAll('-', '');
        tickets.set(ticket, { ...scope, betaSid: session.betaSid, betaInviteVersion: session.betaInviteVersion, until: now() + TICKET_TTL });
        return result({ ticket, protocol: ARCADE_PROTOCOL, expiresInMs: TICKET_TTL });
    }
    async function upgrade(protocols, session) {
        const list = String(protocols || '').split(',').map(value => value.trim());
        if (list.length !== 2 || list[0] !== ARCADE_PROTOCOL || !/^m[a-f0-9]{32}$/.test(list[1])) return result({ error: 'Match grant required.' }, 403);
        pruneTickets();
        const scope = tickets.get(list[1]);
        if (!scope || !sameSession(scope, session)) return result({ error: 'Match grant expired.' }, 403);
        tickets.delete(list[1]);
        const binding = member(scope);
        if (!binding || !await active(binding)) return result({ error: 'Room membership required.' }, 403);
        const peers = sockets();
        const existing = peers.filter(ws => ws.deserializeAttachment()?.actor === scope.actor);
        if (peers.length - existing.length >= SOCKET_CAP) return result({ error: 'Match capacity unavailable.' }, 429);
        const pair = new WebSocketPair();
        const { until: _until, ...attachment } = scope;
        state.acceptWebSocket(pair[1], [ARCADE_TAG]);
        pair[1].serializeAttachment({ ...attachment, kind: ARCADE_TAG });
        for (const ws of existing) close(ws, 4409, 'match connection replaced');
        send(pair[1], { t: 'match-ready', version: 1 });
        return new Response(null, { status: 101, webSocket: pair[0], headers: { 'Sec-WebSocket-Protocol': ARCADE_PROTOCOL } });
    }
    async function load(scope) {
        const record = await state.storage.get(key(scope));
        if (!record) return null;
        if (record.expiresAt <= now()) { await state.storage.delete(key(scope)); return null; }
        return { expiresAt: record.expiresAt, game: GameNightChess.restore(record.chess) };
    }
    function publish(scope, game, requester = null) {
        for (const socket of requester ? [requester] : sockets()) {
            const recipient = socket.deserializeAttachment();
            if (recipient?.ref !== scope.ref || recipient.room !== scope.room) continue;
            const binding = member(recipient);
            if (!binding) { close(socket, 4403, 'room membership ended'); continue; }
            const subjects = game?.subjects ?? [];
            const permitted = subjects.every(subject => binding.canSee(subject));
            try { socket.serializeAttachment({ ...recipient, subjects: permitted ? subjects : [] }); }
            catch { close(socket, 1011, 'match connection unavailable'); continue; }
            send(socket, { t: 'match-state', version: 1, room: recipient.room,
                state: permitted && game ? game.view(binding.betaSid, now()) : null, canOpen: binding.canOpen });
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
                    if (!binding.canOpen || game) error = 'unavailable';
                    else if ((await state.storage.list({ prefix: PREFIX, limit: MATCH_CAP })).size >= MATCH_CAP) error = 'unavailable';
                    else { game = new GameNightChess(uuid(), subject); changed = true; expiresAt = now() + MATCH_TTL; }
                } else if (!game) error = 'match-changed';
                else if (frame.action === 'join') {
                    if (!binding.canJoin(game.subjects[0]) || !game.join(subject, frame.id, now())) error = 'seat-unavailable';
                    else { changed = true; expiresAt = now() + MATCH_TTL; }
                } else if (frame.action === 'leave') {
                    if (!game.seat(subject) || game.view(subject, now()).id !== frame.id) error = 'match-changed';
                    else { game = null; changed = true; }
                } else if (frame.action === 'rematch') {
                    if (!game.requestRematch(subject, frame.id, uuid(), now())) error = 'rematch-unavailable';
                    else { changed = true; expiresAt = now() + MATCH_TTL; }
                } else {
                    const outcome = game.command(subject, frame, now());
                    changed ||= outcome.ok || outcome.changed === true;
                    if (!outcome.ok) error = outcome.reason;
                }
            }
            if (frame.action === 'sync' && !scope.synced) {
                socket.serializeAttachment({ ...socket.deserializeAttachment(), synced: true });
            }
            if (changed) {
                if (game) await state.storage.put(key(scope), { room: scope.room, expiresAt, chess: game.checkpoint() });
                else await state.storage.delete(key(scope));
                publish(scope, game);
            } else publish(scope, game, resume ? null : socket);
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
            const game = (await load(scope))?.game;
            if (game?.seat(subject)) {
                await state.storage.delete(key(scope));
            }
            pending.delete(subject);
            if (!pending.size) pendingRevocations.delete(scope.ref);
            if (game?.seat(subject)) publish(scope, null);
            return true;
        } catch {
            for (const ws of sockets()) if (ws.deserializeAttachment()?.ref === scope.ref) close(ws, 1011, 'match storage unavailable');
            return false;
        }
    }
    async function maintain() {
        reconcile();
        const records = await state.storage.list({ prefix: PREFIX, limit: MATCH_CAP });
        for (const [name, record] of records) {
            const scope = { room: record.room, ref: name.slice(PREFIX.length) };
            if (record.expiresAt <= now()) {
                await state.storage.delete(name);
                publish(scope, null);
            } else {
                const game = GameNightChess.restore(record.chess);
                if (!game.expire(now())) continue;
                await state.storage.put(name, { ...record, chess: game.checkpoint() });
                publish(scope, game);
            }
        }
    }
    return { issue, upgrade, receive, reconcile, revoke, maintain };
}
