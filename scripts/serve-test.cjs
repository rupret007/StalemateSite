'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { resolveTestPort, parseHangoutRelayPath } = require('./lib/e2e-test-server.cjs');

const ROOT = path.resolve(__dirname, '..');
const PORT = resolveTestPort(process.env);
const PROJECT_PREFIX = '/StalemateSite';
const MIME = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.m4a': 'audio/mp4',
    '.mjs': 'text/javascript; charset=utf-8',
    '.tflite': 'application/octet-stream',
    '.wasm': 'application/wasm',
    '.mp4': 'video/mp4',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.webp': 'image/webp',
    '.xml': 'application/xml; charset=utf-8'
};

function stripPrefix(urlPath) {
    if (urlPath === PROJECT_PREFIX || urlPath === `${PROJECT_PREFIX}/`) {
        return '/';
    }
    if (urlPath.startsWith(`${PROJECT_PREFIX}/`)) {
        return urlPath.slice(PROJECT_PREFIX.length);
    }
    return urlPath;
}

function safeJoin(urlPath) {
    const decoded = decodeURIComponent(urlPath.split('?')[0]);
    const relative = stripPrefix(decoded);
    const withIndex = relative.endsWith('/') ? `${relative}index.html` : relative;
    const resolved = path.resolve(ROOT, `.${withIndex}`);
    const rel = path.relative(ROOT, resolved);

    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return null;
    }

    return resolved;
}

function send(response, status, body, headers = {}) {
    response.writeHead(status, {
        'Cache-Control': 'no-store',
        ...headers
    });
    response.end(body);
}

function sendFile(request, response, filePath, status = 200) {
    const type = MIME[path.extname(filePath)] || 'application/octet-stream';
    const contents = fs.readFileSync(filePath);
    const headers = {
        'Content-Type': type,
        'Content-Length': contents.length,
        'Accept-Ranges': 'bytes'
    };
    const range = request.method === 'GET' && status === 200
        && /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || '');
    if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : Math.max(0, contents.length - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), contents.length - 1) : contents.length - 1;
        if (start > end || start >= contents.length) {
            send(response, 416, undefined, { ...headers, 'Content-Length': 0, 'Content-Range': `bytes */${contents.length}` });
            return;
        }
        send(response, 206, contents.subarray(start, end + 1), {
            ...headers,
            'Content-Length': end - start + 1,
            'Content-Range': `bytes ${start}-${end}/${contents.length}`
        });
        return;
    }
    send(response, status, request.method === 'HEAD' ? undefined : contents, headers);
}

async function main() {
    const { createHangoutRelay } = await import('./hangout-relay-dev.mjs');
    const origin = `http://127.0.0.1:${PORT}`;
    // Each browser scenario can choose a namespace while retaining CSP's same-origin
    // relay. Engines keep their real limits, moderation state and membership rules.
    const hangoutRelays = new Map();
    const relayFor = (namespace) => {
        if (!hangoutRelays.has(namespace)) hangoutRelays.set(namespace, createHangoutRelay({
            previewKey: 'local-preview-key-0001',
            devAdminKey: process.env.HANGOUT_DEV_ADMIN_KEY || 'local-dev-admin-key-0001',
            origins: origin,
            lobbyLimits: { pmMinLobbyMs: 1500 }
        }));
        return hangoutRelays.get(namespace);
    };

    const server = http.createServer(async (request, response) => {
        const url = new URL(request.url, origin);
        const urlPath = url.pathname;

        if (urlPath === '/__test/hangout-device-cookie' && request.method === 'POST') {
            const { signDevice, newDeviceId, deviceCookie } = await import('../hangout-worker/src/auth.mjs');
            const token = await signDevice(newDeviceId(), 'local-dev-only-hmac-key-not-a-secret-000');
            send(response, 204, undefined, { 'Set-Cookie': deviceCookie(token) });
            return;
        }

        if (request.method !== 'GET' && request.method !== 'HEAD') {
            send(response, 405, 'Method Not Allowed', { Allow: 'GET, HEAD, POST' });
            return;
        }

        const relayRoute = parseHangoutRelayPath(urlPath);
        if (relayRoute?.pathname === '/__test/modlog.json') {
            const body = JSON.stringify(relayFor(relayRoute.namespace).lobby.modlog);
            send(response, 200, request.method === 'HEAD' ? undefined : body, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(body)
            });
            return;
        }

        const filePath = safeJoin(urlPath);

        if (!filePath) {
            send(response, 400, 'Bad Request', { 'Content-Type': 'text/plain; charset=utf-8' });
            return;
        }

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            sendFile(request, response, filePath);
            return;
        }

        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
            const indexPath = path.join(filePath, 'index.html');
            if (fs.existsSync(indexPath)) {
                sendFile(request, response, indexPath);
                return;
            }
        }

        sendFile(request, response, path.join(ROOT, '404.html'), 404);
    });

    // Keep idle sockets open longer than any client pool so a reused keep-alive
    // socket is never closed mid-request (undici "other side closed" flake).
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;

    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, origin);
        const relayRoute = parseHangoutRelayPath(url.pathname);
        if (!relayRoute) {
            socket.destroy();
            return;
        }
        url.pathname = relayRoute.pathname;
        relayFor(relayRoute.namespace).handleUpgrade(req, socket, head, url);
    });

    server.listen(PORT, '127.0.0.1', () => {
        process.stdout.write(`Stalemate test server on ${origin}\n`);
    });
}

main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exit(1);
});
