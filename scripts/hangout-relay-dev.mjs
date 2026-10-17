// Local stand-in for the hangout Cloudflare Worker, used by tests and local previews.
// Same admission rules and caps (from hangout-worker/src/core.mjs); in-memory only.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { admit, createBucket, limitsFrom, validFrame } from '../hangout-worker/src/core.mjs';

export function startRelay({ port = 0, previewKey = 'local-preview-key-0001', origins = '', connectionsPerDay } = {}) {
    const env = { HANGOUT_PREVIEW_KEY: previewKey, ROOMS: {}, QUOTA: {}, HANGOUT_CONNECTIONS_PER_DAY: connectionsPerDay };
    const limits = limitsFrom(env);
    const rooms = new Map();
    let connections = 0;
    let seq = 0;
    const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
    const wss = new WebSocketServer({ noServer: true, maxPayload: limits.maxFrameBytes });
    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, 'http://relay');
        const reject = (status, reason) => { socket.end(`HTTP/1.1 ${status} ${reason}\r\n\r\n`); };
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
    });
    return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ port: server.address().port, close: () => new Promise((r) => { wss.clients.forEach((c) => c.terminate()); server.close(r); }) })));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
    const port = Number(process.env.HANGOUT_RELAY_PORT || 4330);
    startRelay({ port, previewKey: process.env.HANGOUT_PREVIEW_KEY || 'local-preview-key-0001', origins: process.env.HANGOUT_EXTRA_ORIGINS || 'http://127.0.0.1:4320' })
        .then((r) => process.stdout.write(`hangout relay on ws://127.0.0.1:${r.port}\n`));
}
