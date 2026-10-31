// Local stand-in for the hangout Cloudflare Worker, used by tests and local previews.
// Same admission rules and caps (from hangout-worker/src/core.mjs). Persistence and
// identity adapters are used only by the explicit loopback preview launcher.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { admit, createBucket, limitsFrom, validFrame, originAllowed, previewKeyOk } from '../hangout-worker/src/core.mjs';
import { createLobby } from '../hangout-worker/src/lobby-core.mjs';
import { accountId, deviceFromProtocols, ipHash, newDeviceId, signDevice, verifyDevice } from '../hangout-worker/src/auth.mjs';

const DEV_HMAC = 'local-dev-only-hmac-key-not-a-secret-000';

// devAdminKey: TEST-ONLY stand-in for Cloudflare Access. The real Worker has no such path (see lobby-do.mjs).
export function createHangoutRelay({ previewKey = 'local-preview-key-0001', origins = '', connectionsPerDay, devAdminKey = '', lobbyLimits = {}, now, resolveIdentity = null, initialState = {}, persist = () => {} } = {}) {
    const env = { HANGOUT_PREVIEW_KEY: previewKey, ROOMS: {}, QUOTA: {}, HANGOUT_CONNECTIONS_PER_DAY: connectionsPerDay };
    const limits = limitsFrom(env);
    const rooms = new Map();
    let connections = 0;
    let seq = 0;
    const wss = new WebSocketServer({
        noServer: true,
        maxPayload: limits.maxFrameBytes,
        handleProtocols: (protocols) => (protocols.has('hangout') ? 'hangout' : false)
    });
    const lobbySockets = new Map();
    const pendingAdmission = new Map();
    let work = Promise.resolve();
    let stopping = false;
    // Match the DO's serial processing when a persistence adapter returns promises.
    const enqueue = (fn) => { const task = work.then(fn); work = task.catch(() => {}); return task; };
    const lobby = createLobby({
        now,
        limits: lobbyLimits,
        persist,
        send: (id, msg) => { const ws = lobbySockets.get(id); if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); else pendingAdmission.get(id)?.push(msg); },
        close: (id, code, reason) => { const ws = lobbySockets.get(id); if (ws) ws.close(code, reason); }
    });
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
            let dev = await verifyDevice(deviceFromProtocols(req.headers['sec-websocket-protocol']), DEV_HMAC);
            if (!dev) dev = newDeviceId();
            const token = await signDevice(dev, DEV_HMAC);
            const iph = await ipHash(resolveIdentity ? req.socket.remoteAddress : req.headers['x-test-ip'] || url.searchParams.get('testip') || req.socket.remoteAddress, DEV_HMAC);
            const id = `c${(lobbySeq += 1)}`;
            pendingAdmission.set(id, []);
            let verdict;
            try { verdict = await enqueue(() => lobby.connect({ id, dev, iph, role, account, admin: url.pathname === '/lobby-admin' })); }
            catch { pendingAdmission.delete(id); return reject(503, 'storage'); }
            if (!verdict.ok) { pendingAdmission.delete(id); return reject(verdict.status, verdict.reason); }
            if (socket.destroyed) { pendingAdmission.delete(id); enqueue(() => lobby.disconnect(id)).catch(() => {}); return; }
            return wss.handleUpgrade(req, socket, head, (ws) => {
                lobbySockets.set(id, ws);
                if (token) ws.send(JSON.stringify({ t: 'device', token }));
                for (const frame of pendingAdmission.get(id) || []) ws.send(JSON.stringify(frame));
                pendingAdmission.delete(id);
                ws.on('message', (data) => { enqueue(() => lobby.message(id, String(data))).catch(() => ws.close(4503, 'local storage')); });
                ws.on('close', () => { lobbySockets.delete(id); enqueue(() => lobby.disconnect(id)).catch(() => {}); });
            });
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
            const cast = (payload, except) => { const t = JSON.stringify(payload); room.forEach((p) => { if (p !== except && p.readyState === 1) p.send(t); }); };
            ws.send(JSON.stringify({ welcome: true, id: ws.id, t: Date.now(), peers: room.size, max: limits.maxPeers }));
            cast({ peers: room.size, t: Date.now() }, ws);
            ws.on('message', (data) => {
                const v = ws.bucket.take();
                if (v === 'spent') return ws.close(4429, 'message cap');
                if (v === 'slow') return ws.send(JSON.stringify({ slow: true }));
                const frame = validFrame(String(data), limits);
                if (!frame) return ws.close(4400, 'bad frame');
                cast({ t: Date.now(), from: ws.id, iv: frame.iv, c: frame.c }, ws);
            });
            ws.on('close', () => { room.delete(ws); cast({ peers: room.size, left: ws.id, t: Date.now() }); if (!room.size) rooms.delete(roomId); });
        });
    };

    const close = async () => {
        stopping = true;
        clearInterval(ticker);
        wss.clients.forEach((c) => c.terminate());
        await new Promise((resolve) => wss.close(resolve));
        await work;
    };

    return { handleUpgrade, lobby, close, settled: () => work };
}

export function startRelay(options = {}) {
    const relay = createHangoutRelay(options);
    const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, 'http://relay');
        relay.handleUpgrade(req, socket, head, url);
    });
    const { port = 0 } = options;
    return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
        port: server.address().port,
        lobby: relay.lobby,
        close: () => relay.close().then(() => new Promise((r) => server.close(r)))
    })));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
    const port = Number(process.env.HANGOUT_RELAY_PORT || 4330);
    startRelay({ port, devAdminKey: process.env.HANGOUT_DEV_ADMIN_KEY || '', previewKey: process.env.HANGOUT_PREVIEW_KEY || 'local-preview-key-0001', origins: process.env.HANGOUT_EXTRA_ORIGINS || 'http://127.0.0.1:4320' })
        .then((r) => process.stdout.write(`hangout relay on ws://127.0.0.1:${r.port}\n`));
}
