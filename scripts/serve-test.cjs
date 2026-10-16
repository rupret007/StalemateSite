'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { resolveTestPort } = require('./lib/e2e-test-server.cjs');

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

function sendFile(response, filePath, status = 200) {
    const type = MIME[path.extname(filePath)] || 'application/octet-stream';
    send(response, status, fs.readFileSync(filePath), { 'Content-Type': type });
}

const server = http.createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        send(response, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
        return;
    }

    const urlPath = new URL(request.url, `http://127.0.0.1:${PORT}`).pathname;
    const filePath = safeJoin(urlPath);

    if (!filePath) {
        send(response, 400, 'Bad Request', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        sendFile(response, filePath);
        return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        const indexPath = path.join(filePath, 'index.html');
        if (fs.existsSync(indexPath)) {
            sendFile(response, indexPath);
            return;
        }
    }

    sendFile(response, path.join(ROOT, '404.html'), 404);
});

server.listen(PORT, '127.0.0.1', () => {
    process.stdout.write(`Stalemate test server on http://127.0.0.1:${PORT}\n`);
});
