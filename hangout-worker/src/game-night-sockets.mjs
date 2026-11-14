const TICKET_TTL = 10000;
const SOCKET_CAP = 60;
const result = (value, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

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

// Each channel gets its own ticket store, subprotocol and socket tag. A grant
// for one connection cannot authorize a different channel or room instance.
export function createGameNightSockets({ state, tag, protocol, readyType, readyFeatures, snapshots = false, current, active, charge, allowed,
    now = () => Date.now(), uuid = () => crypto.randomUUID() }) {
    const tickets = new Map();
    const sockets = () => state.getWebSockets(tag).filter(ws => ws.readyState === 1 && ws.deserializeAttachment()?.kind === tag);
    function send(socket, frame) { try { socket.send(JSON.stringify(frame)); } catch { /* disconnected */ } }
    function close(socket, code, reason) {
        try { socket.serializeAttachment({ ...socket.deserializeAttachment(), retired: true }); } catch { /* disconnected */ }
        try { socket.close(code, reason); } catch { /* disconnected */ }
    }
    function member(scope) {
        const binding = !scope?.retired && allowed(scope) && current(scope);
        return binding && sameSession(scope, binding) ? binding : null;
    }
    function pruneTickets() {
        for (const [ticket, scope] of tickets) if (scope.until <= now() || !member(scope)) tickets.delete(ticket);
    }
    async function issue(scope, session) {
        const binding = current(scope);
        if (!allowed(scope) || !sameSession(binding, session) || !await active(binding)) {
            return result({ error: 'Room membership required.' }, 403);
        }
        pruneTickets();
        for (const [ticket, prior] of tickets) if (prior.actor === scope.actor) tickets.delete(ticket);
        if (tickets.size >= SOCKET_CAP || !await charge(binding.socket, scope.actor)) return result({ error: 'Room connection capacity unavailable.' }, 429);
        const ticket = 'm' + uuid().replaceAll('-', '');
        tickets.set(ticket, { ...scope, betaSid: session.betaSid, betaInviteVersion: session.betaInviteVersion, until: now() + TICKET_TTL });
        return result({ ticket, protocol, expiresInMs: TICKET_TTL });
    }
    async function upgrade(protocols, session) {
        const list = String(protocols || '').split(',').map(value => value.trim());
        if (list.length !== 2 || list[0] !== protocol || !/^m[a-f0-9]{32}$/.test(list[1])) return result({ error: 'Room grant required.' }, 403);
        pruneTickets();
        const scope = tickets.get(list[1]);
        if (!scope || !sameSession(scope, session)) return result({ error: 'Room grant expired.' }, 403);
        tickets.delete(list[1]);
        const binding = member(scope);
        if (!binding || !await active(binding)) return result({ error: 'Room membership required.' }, 403);
        const peers = sockets();
        const existing = peers.filter(ws => ws.deserializeAttachment()?.actor === scope.actor);
        if (peers.length - existing.length >= SOCKET_CAP) return result({ error: 'Room connection capacity unavailable.' }, 429);
        const pair = new WebSocketPair();
        const { until: _until, ...attachment } = scope;
        state.acceptWebSocket(pair[1], [tag]);
        pair[1].serializeAttachment({ ...attachment, kind: tag });
        for (const ws of existing) close(ws, 4409, 'room connection replaced');
        send(pair[1], { t: readyType, version: 1, ...readyFeatures, ...(snapshots ? { snapshots: true } : {}) });
        return new Response(null, { status: 101, webSocket: pair[0], headers: { 'Sec-WebSocket-Protocol': protocol } });
    }
    return { issue, upgrade, member, sockets, send, close };
}
