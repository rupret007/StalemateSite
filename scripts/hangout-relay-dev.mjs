// Local stand-in for the hangout Cloudflare Worker, used by tests and local previews.
// Same admission rules and caps (from hangout-worker/src/core.mjs); in-memory only.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { admit, createBucket, limitsFrom, validFrame, originAllowed, previewKeyOk } from '../hangout-worker/src/core.mjs';
import { createLobby } from '../hangout-worker/src/lobby-core.mjs';
import { ipHash, newDeviceId, signDevice, verifyDevice } from '../hangout-worker/src/auth.mjs';

const DEV_HMAC = 'local-dev-only-hmac-key-not-a-secret-000';

// devAdminKey: TEST-ONLY stand-in for Cloudflare Access. The real Worker has no such path (see lobby-do.mjs).
export function startRelay({ port = 0, previewKey = 'local-preview-key-0001', origins = '', connectionsPerDay, devAdminKey = '', lobbyLimits = {}, now } = {}) {
    const env = { HANGOUT_PREVIEW_KEY: previewKey, ROOMS: {}, QUOTA: {}, HANGOUT_CONNECTIONS_PER_DAY: connectionsPerDay };
    const limits = limitsFrom(env);
    const rooms = new Map();
    let connections = 0;
    let seq = 0;
    const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
    const wss = new WebSocketServer({ noServer: true, maxPayload: limits.maxFrameBytes });
    const lobbySockets = new Map();
    const lobby = createLobby({
        now,
        limits: lobbyLimits,
        send: (id, msg) => { const ws = lobbySockets.get(id); if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); },
        close: (id, code, reason) => { const ws = lobbySockets.get(id); if (ws) ws.close(code, reason); }
    });
    const ticker = setInterval(() => lobby.tick(), 1000);
    let lobbySeq = 0;
    server.on('upgrade', async (req, socket, head) => {
        const url = new URL(req.url, 'http://relay');
        const reject = (status, reason) => { socket.end(`HTTP/1.1 ${status} ${reason}\r\n\r\n`); };
        if (url.pathname === '/lobby' || url.pathname === '/lobby-admin') {
            if (!originAllowed(req.headers.origin, origins)) return reject(403, 'origin');
            if (!previewKeyOk(url.searchParams.get('preview'), previewKey)) return reject(403, 'preview');
            let role = 'fan';
            if (url.pathname === '/lobby-admin') {
                if (!devAdminKey || !previewKeyOk(url.searchParams.get('devadmin'), devAdminKey)) return reject(403, 'access');
                role = url.searchParams.get('as') === 'owner' ? 'owner' : 'band';
            }
            let dev = await verifyDevice(url.searchParams.get('dev'), DEV_HMAC);
            const token = dev ? null : await signDevice((dev = newDeviceId()), DEV_HMAC);
            // Tests may pose as a different IP via x-test-ip (dev relay only) to exercise IP-hash bans.
            const iph = await ipHash(req.headers['x-test-ip'] || url.searchParams.get('testip') || req.socket.remoteAddress, DEV_HMAC);
            const id = `c${(lobbySeq += 1)}`;
            const verdict = lobby.connect({ id, dev, iph, role, admin: role !== 'fan' });
            if (!verdict.ok) return reject(verdict.status, verdict.reason);
            return wss.handleUpgrade(req, socket, head, (ws) => {
                lobbySockets.set(id, ws);
                if (token) ws.send(JSON.stringify({ t: 'device', token }));
                ws.send(JSON.stringify({ t: 'hello', role, needNick: true }));
                ws.on('message', (data) => lobby.message(id, String(data)));
                ws.on('close', () => { lobbySockets.delete(id); lobby.disconnect(id); });
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
            ws.on('close', () => { room.delete(ws); cast({ peers: room.size, t: Date.now() }); if (!room.size) rooms.delete(roomId); });
        });
    });
    return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ port: server.address().port, lobby, close: () => new Promise((r) => { clearInterval(ticker); wss.clients.forEach((c) => c.terminate()); server.close(r); }) })));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
    const port = Number(process.env.HANGOUT_RELAY_PORT || 4330);
    startRelay({ port, devAdminKey: process.env.HANGOUT_DEV_ADMIN_KEY || '', previewKey: process.env.HANGOUT_PREVIEW_KEY || 'local-preview-key-0001', origins: process.env.HANGOUT_EXTRA_ORIGINS || 'http://127.0.0.1:4320' })
        .then((r) => process.stdout.write(`hangout relay on ws://127.0.0.1:${r.port}\n`));
}
