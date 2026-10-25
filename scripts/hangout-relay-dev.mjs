// Local stand-in for the hangout Cloudflare Worker, used by tests and local previews.
// Same admission rules and caps (from hangout-worker/src/core.mjs). Persistence and
// identity adapters are used only by the explicit loopback preview launcher.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { admit, createBucket, limitsFrom, validFrame, originAllowed, previewKeyOk } from '../hangout-worker/src/core.mjs';
import { createLobby, LOBBY_LIMITS } from '../hangout-worker/src/lobby-core.mjs';
import { accountId, ipHash, newDeviceId, signDevice, verifyDevice } from '../hangout-worker/src/auth.mjs';
import { createBoundedSerialQueue, createSocketDelivery } from '../hangout-worker/src/socket-delivery.mjs';
import { createTransportControlBudget } from '../hangout-worker/src/transport-budget.mjs';
import { createPresenceProjections } from '../hangout-worker/src/presence-projections.mjs';

const DEV_HMAC = 'local-dev-only-hmac-key-not-a-secret-000';

// devAdminKey: TEST-ONLY stand-in for Cloudflare Access. The real Worker has no such path (see lobby-do.mjs).
export function createHangoutRelay({ previewKey = 'local-preview-key-0001', origins = '', connectionsPerDay, devAdminKey = '', lobbyLimits = {}, now, resolveIdentity = null, initialState = {}, persist = () => {} } = {}) {
    const env = { HANGOUT_PREVIEW_KEY: previewKey, ROOMS: {}, QUOTA: {}, HANGOUT_CONNECTIONS_PER_DAY: connectionsPerDay };
    const limits = limitsFrom(env);
    const rooms = new Map();
    let connections = 0;
    let seq = 0;
    const wss = new WebSocketServer({ noServer: true, maxPayload: limits.maxFrameBytes });
    const lobbySockets = new Map();
    const pendingAdmission = new Map();
    const inbound = { frames: 0, bytes: 0 };
    let stopping = false;
    // Match the DO's serial processing when a persistence adapter returns promises.
    const work = createBoundedSerialQueue();
    const enqueue = (fn, bytes = 0) => work.enqueue(fn, bytes);
    const retired = new WeakSet();
    const retire = ws => {
        delivery.forget(ws);
        if (!ws.lobbyId || retired.has(ws)) return;
        retired.add(ws); lobbySockets.delete(ws.lobbyId);
        work.enqueueCleanup(() => lobby.disconnect(ws.lobbyId)).catch(() => {});
    };
    const delivery = createSocketDelivery({
        onClosed: retire,
        closeSocket: (ws, code, reason) => {
            ws.close(code, reason);
            // A stopped reader cannot retain the bounded socket buffer for the
            // library's longer close-handshake timeout.
            const timer = setTimeout(() => ws.terminate(), 1000);
            timer.unref?.(); ws.once('close', () => clearTimeout(timer));
        }
    });
    const lobby = createLobby({
        now,
        limits: lobbyLimits,
        persist,
        deferPresence: marker => presence.mark(marker),
        send: (id, msg) => { const ws = lobbySockets.get(id); if (ws) delivery.send(ws, msg); else pendingAdmission.get(id)?.push(msg); },
        close: (id, code, reason) => { const ws = lobbySockets.get(id); if (ws) ws.close(code, reason); }
    });
    const presence = createPresenceProjections({ flush: batch => lobby.flushPresence(batch), serialize: fn => work.enqueueCleanup(fn) });
    const controlBudget = createTransportControlBudget({ reserve: id => lobby.reserveTransportControl(id), available: id => lobby.transportControlReady(id), now });
    if (initialState.net !== undefined) lobby.restore(initialState.net);
    lobby.restoreAiReviews(initialState['ai-reviews'] || []);
    lobby.restoreModerationQueue(initialState['moderation-queue'] || {});
    lobby.restoreLog(initialState.modlog || []);
    enqueue(async () => { await lobby.restoreRooms(initialState.rooms); lobby.restoreAbuse(initialState.abuse); await lobby.tick(); });
    const ticker = setInterval(() => { enqueue(() => lobby.tick()).catch(() => {}); }, 1000);
    let lobbySeq = 0;

    const handleUpgrade = async (req, socket, head, url) => {
        const reject = (status, reason) => { socket.end(`HTTP/1.1 ${status} ${reason}\r\n\r\n`); };
        if (stopping) return reject(503, 'stopping');
        if (url.pathname === '/lobby' || url.pathname === '/lobby-admin' || url.pathname === '/lobby-owner') {
            if (!originAllowed(req.headers.origin, origins)) return reject(403, 'origin');
            if (!previewKeyOk(url.searchParams.get('preview'), previewKey)) return reject(403, 'preview');
            let role = 'fan'; let account = '';
            if (resolveIdentity) {
                const identity = await resolveIdentity(req, url);
                if (!identity) return reject(403, 'local-preview-identity');
                role = identity.role || 'fan'; account = identity.account || '';
                if (url.pathname === '/lobby-owner' && !account || url.pathname === '/lobby-admin' && role === 'fan') return reject(403, 'local-preview-role');
            } else if (url.pathname === '/lobby-owner') {
                if (!devAdminKey || !previewKeyOk(url.searchParams.get('devowner'), devAdminKey)) return reject(403, 'owner-access');
                account = await accountId(url.searchParams.get('account') || 'owner-fixture@example.test', DEV_HMAC);
            }
            if (!resolveIdentity && url.pathname === '/lobby-admin') {
                if (!devAdminKey || !previewKeyOk(url.searchParams.get('devadmin'), devAdminKey)) return reject(403, 'access');
                role = ['owner', 'moderator'].includes(url.searchParams.get('as')) ? url.searchParams.get('as') : 'band';
            }
            let dev = await verifyDevice(url.searchParams.get('dev'), DEV_HMAC);
            const token = dev ? null : await signDevice((dev = newDeviceId()), DEV_HMAC);
            const iph = await ipHash(resolveIdentity ? req.socket.remoteAddress : req.headers['x-test-ip'] || url.searchParams.get('testip') || req.socket.remoteAddress, DEV_HMAC);
            const id = `c${(lobbySeq += 1)}`;
            pendingAdmission.set(id, []);
            let verdict;
            try { verdict = await enqueue(() => lobby.connect({ id, dev, iph, role, account, admin: url.pathname === '/lobby-admin' })); }
            catch { pendingAdmission.delete(id); return reject(503, 'storage'); }
            if (!verdict.ok) { pendingAdmission.delete(id); return reject(verdict.status, verdict.reason); }
            if (socket.destroyed) { pendingAdmission.delete(id); work.enqueueCleanup(() => lobby.disconnect(id)).catch(() => {}); return; }
            let accepted = false;
            const upgraded = ws => {
                accepted = true;
                ws.lobbyId = id;
                lobbySockets.set(id, ws);
                if (token) delivery.send(ws, { t: 'device', token });
                for (const frame of pendingAdmission.get(id) || []) delivery.send(ws, frame);
                pendingAdmission.delete(id);
                ws.on('message', (data) => {
                    if (retired.has(ws)) return;
                    inbound.frames += 1; inbound.bytes += data.byteLength;
                    if (data.byteLength > LOBBY_LIMITS.actFrameBytes) { ws.close(4400, 'bad frame'); retire(ws); return; }
                    const raw = String(data);
                    let control;
                    try { control = JSON.parse(raw); } catch { /* The engine refuses malformed application frames. */ }
                    enqueue(async () => {
                        if (retired.has(ws)) return;
                        if (control?.t === 'transport-ack') {
                            if (!await controlBudget.take(ws, id)) { ws.close(4413, 'community control allowance unavailable'); retire(ws); return; }
                            return delivery.acknowledge(ws, control.seq);
                        }
                        if (control?.t === 'hello' && !delivery.negotiate(ws, control.transport)) return;
                        return lobby.message(id, raw);
                    }, data.byteLength).catch(error => {
                        const busy = error?.message === 'local work allowance exceeded';
                        ws.close(busy ? 4413 : 4503, busy ? 'connection busy; reconnect' : 'local storage'); retire(ws);
                    });
                });
                ws.on('close', () => retire(ws));
                ws.on('error', () => retire(ws));
            };
            try { wss.handleUpgrade(req, socket, head, upgraded); } catch { socket.destroy(); }
            finally {
                if (!accepted) {
                    pendingAdmission.delete(id);
                    work.enqueueCleanup(() => lobby.disconnect(id)).catch(() => {});
                }
            }
            return;
        }
        if (url.pathname !== '/room') return reject(404, 'nope');
        const denied = admit({ url, origin: req.headers.origin, env, extraOrigins: origins });
        if (denied) return reject(denied.status, denied.reason);
        if (connections >= limits.connectionsPerDay) return reject(429, 'cap');
        const roomId = url.searchParams.get('room');
        const room = rooms.get(roomId) || new Set();
        if (room.size >= limits.maxPeers) return reject(429, 'full');
        connections += 1;
        wss.handleUpgrade(req, socket, head, (ws) => {
            rooms.set(roomId, room);
            ws.id = `p${(seq += 1)}`;
            ws.bucket = createBucket(limits);
            room.add(ws);
            const cast = (payload, except) => { room.forEach((p) => { if (p !== except) delivery.send(p, payload); }); };
            delivery.send(ws, { welcome: true, id: ws.id, t: Date.now(), peers: room.size, max: limits.maxPeers });
            cast({ peers: room.size, t: Date.now() }, ws);
            ws.on('message', (data) => {
                const v = ws.bucket.take();
                if (v === 'spent') return ws.close(4429, 'message cap');
                if (v === 'slow') return delivery.send(ws, { slow: true });
                const frame = validFrame(String(data), limits);
                if (!frame) return ws.close(4400, 'bad frame');
                cast({ t: Date.now(), from: ws.id, iv: frame.iv, c: frame.c }, ws);
            });
            ws.on('close', () => { delivery.forget(ws); room.delete(ws); cast({ peers: room.size, left: ws.id, t: Date.now() }); if (!room.size) rooms.delete(roomId); });
        });
    };

    const close = async () => {
        stopping = true;
        presence.dispose();
        clearInterval(ticker);
        wss.clients.forEach((c) => c.terminate());
        await new Promise((resolve) => wss.close(resolve));
        await work.settled();
    };

    return { handleUpgrade, lobby, close, settled: async () => { await work.settled(); await presence.flush(); await work.settled(); }, metrics: () => ({ inbound: { ...inbound }, delivery: delivery.snapshot(), controlBudget: controlBudget.snapshot(), work: work.snapshot(), presence: presence.snapshot() }) };
}

export function startRelay(options = {}) {
    const relay = createHangoutRelay(options);
    const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, 'http://relay');
        relay.handleUpgrade(req, socket, head, url);
    });
    const { port = 0 } = options;
    return new Promise((resolve, reject) => {
        const failed = error => { relay.close().then(() => reject(error), () => reject(error)); };
        server.once('error', failed);
        server.listen(port, '127.0.0.1', () => {
            server.off('error', failed);
            resolve({ port: server.address().port, lobby: relay.lobby, metrics: relay.metrics,
                close: () => relay.close().then(() => new Promise((r) => server.close(r))) });
        });
    });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
    const port = Number(process.env.HANGOUT_RELAY_PORT || 4330);
    startRelay({ port, devAdminKey: process.env.HANGOUT_DEV_ADMIN_KEY || '', previewKey: process.env.HANGOUT_PREVIEW_KEY || 'local-preview-key-0001', origins: process.env.HANGOUT_EXTRA_ORIGINS || 'http://127.0.0.1:4320' })
        .then((r) => process.stdout.write(`hangout relay on ws://127.0.0.1:${r.port}\n`));
}
