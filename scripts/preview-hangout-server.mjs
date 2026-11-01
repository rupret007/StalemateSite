// Explicit human preview. This module is excluded from the Pages package and is
// never imported by the Worker or the automated test server.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createHangoutRelay } from './hangout-relay-dev.mjs';
import { accountId } from '../hangout-worker/src/auth.mjs';
import { LOG_TTL } from '../hangout-worker/src/community-state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'scripts', 'preview-ui');
const PREFIX = '/__preview';
const KEY = 'local-preview-key-0001';
const DAY = 86400000;
const PROFILES = Object.freeze({
    guest: { label: 'Guest', role: 'fan', nick: 'Guest' },
    'room-owner-a': { label: 'Room owner A · email stand-in', role: 'fan', email: 'preview-owner-a@local.invalid', nick: 'RoomOwnerA' },
    'room-owner-b': { label: 'Room owner B · email stand-in', role: 'fan', email: 'preview-owner-b@local.invalid', nick: 'RoomOwnerB' },
    moderator: { label: 'Community moderator', role: 'moderator', email: 'preview-moderator@local.invalid', nick: 'LocalModerator' },
    administrator: { label: 'Site owner administrator', role: 'owner', email: 'preview-administrator@local.invalid', nick: 'LocalAdmin' }
});
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.tflite': 'application/octet-stream', '.json': 'application/json; charset=utf-8' };
const CSP = "default-src 'self'; script-src 'self' https://www.youtube.com; style-src 'self'; frame-src https://www.youtube.com; connect-src 'self'; media-src 'self' blob:; img-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const token = () => randomBytes(24).toString('hex');

export function defaultPreviewStatePath() {
    const base = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
    return path.join(base, 'Stalemate', 'hangout-preview.json');
}

function stateStore(filePath) {
    let value = { version: 1, sessions: [], lobby: {} };
    if (fs.existsSync(filePath)) {
        if (fs.statSync(filePath).size > 16 * 1024 * 1024) throw new Error('Local preview state is too large. Back it up and remove it before restarting.');
        value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (value?.version !== 1 || !Array.isArray(value.sessions) || value.sessions.length > 1000 || !value.lobby || typeof value.lobby !== 'object' || Array.isArray(value.lobby)
            || value.sessions.some((s) => !/^[a-f0-9]{48}$/.test(s?.token) || !Object.hasOwn(PROFILES, s.profile) || !Number.isFinite(s.at))) throw new Error('Invalid local preview state. Back it up and remove it before restarting.');
    }
    const write = () => {
        fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
        const temporary = `${filePath}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
        fs.renameSync(temporary, filePath);
        fs.chmodSync(filePath, 0o600);
    };
    return { value, write };
}

// Always bind an explicit loopback address. No host/listen override is accepted.
export async function startPreview({ port = 4387, statePath = defaultPreviewStatePath() } = {}) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Preview port must be an integer from 0 to 65535.');
    const hiddenDir = fs.readdirSync(path.join(ROOT, 'r'), { withFileTypes: true }).find((entry) => entry.isDirectory() && /^[a-f0-9]{16}$/.test(entry.name))?.name;
    if (!hiddenDir) throw new Error('Hidden community assets are missing.');
    const productPrefix = `/r/${hiddenDir}`;
    const store = stateStore(statePath);
    store.value.sessions = store.value.sessions.filter((session) => Date.now() - session.at < 7 * DAY && session.at <= Date.now());
    const sessions = new Map(store.value.sessions.map((session) => [session.token, session]));
    const csrf = token();
    let origin = '';
    let relay;
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Content-Security-Policy': CSP };
    const send = (res, status, body = '', extra = {}, head = false) => {
        res.writeHead(status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8', ...extra });
        res.end(head ? undefined : body);
    };
    const json = (res, status, body) => send(res, status, JSON.stringify(body), { 'Content-Type': 'application/json; charset=utf-8' });
    const validHost = (req) => req.headers.host === new URL(origin).host;
    const sessionRoute = (pathname, kind) => new RegExp(`^${PREFIX}/${kind}/([a-f0-9]{48})(/.*)?$`).exec(pathname);
    const activeSession = (id) => { const s = sessions.get(id); return s && Date.now() - s.at < 7 * DAY ? s : null; };

    const server = http.createServer(async (req, res) => {
        if (!validHost(req)) return send(res, 403, 'Use the exact loopback preview URL.');
        let url;
        try { url = new URL(req.url, origin); } catch { return send(res, 400, 'Invalid URL'); }
        if (url.pathname === `${PREFIX}/sessions` && req.method === 'POST') {
            if (req.headers.origin !== origin || req.headers['x-preview-csrf'] !== csrf || req.headers['content-type'] !== 'application/json') return send(res, 403, 'Local preview control request rejected.');
            let raw = '';
            try {
                for await (const chunk of req) { raw += chunk; if (raw.length > 512) { send(res, 413, 'Request too large'); return; } }
                const { profile } = JSON.parse(raw);
                if (!Object.hasOwn(PROFILES, profile)) return send(res, 400, 'Unknown preview identity');
                if (sessions.size >= 1000) return send(res, 429, 'Too many local preview sessions. Existing sessions expire after seven days.');
                const session = { token: token(), profile, at: Date.now() };
                sessions.set(session.token, session); store.value.sessions.push(session);
                try { store.write(); } catch { sessions.delete(session.token); store.value.sessions.pop(); return send(res, 503, 'Could not save local preview identity.'); }
                const page = ['moderator', 'administrator'].includes(profile) ? 'admin' : 'lobby';
                return json(res, 201, { url: `${PREFIX}/session/${session.token}${productPrefix}/${page}/`, label: PROFILES[profile].label });
            } catch { return send(res, 400, 'Invalid request'); }
        }
        if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
        const head = req.method === 'HEAD';
        if (url.pathname === '/' || url.pathname === `${PREFIX}/` || url.pathname === PREFIX) {
            const body = fs.readFileSync(path.join(ASSETS, 'index.html'), 'utf8').replace('__PREVIEW_NONCE__', csrf);
            return send(res, 200, body, { 'Content-Type': MIME['.html'] }, head);
        }
        if (url.pathname === `${PREFIX}/status`) return json(res, 200, { local: true, ai: 'disabled', identities: sessions.size, connected: relay.lobby._debug.conns.size, persistentRooms: [...relay.lobby._debug.channels.values()].filter((room) => room.owner).length });
        const ownAsset = new RegExp(`^${PREFIX}/assets/(control\\.js|session\\.js|preview\\.css)$`).exec(url.pathname);
        if (ownAsset) return send(res, 200, fs.readFileSync(path.join(ASSETS, ownAsset[1])), { 'Content-Type': MIME[path.extname(ownAsset[1])] }, head);
        const match = sessionRoute(url.pathname, 'session');
        const session = match && activeSession(match[1]);
        if (!session) return send(res, 404, 'Preview session not found. Open the local launcher.');
        let relative;
        try { relative = decodeURIComponent(match[2] || '/'); } catch { return send(res, 400, 'Invalid path'); }
        if (relative.split('/').includes('..') || relative.includes('\\') || relative.includes('\0')) return send(res, 400, 'Invalid path');
        if (!(relative.startsWith(`${productPrefix}/`) || relative.startsWith('/assets/') || relative.startsWith('/js/') || relative === '/countdown.js')) return send(res, 404, 'Preview asset not found');
        const filePath = path.resolve(ROOT, `.${relative}${relative.endsWith('/') ? 'index.html' : ''}`);
        if (!filePath.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || !MIME[path.extname(filePath)]) return send(res, 404, 'Preview asset not found');
        let body = fs.readFileSync(filePath);
        if (path.extname(filePath) === '.html') {
            const profile = PROFILES[session.profile];
            // Edits exist only in the local response. No credentials or local auth
            // switches are injected into repository/product assets.
            body = body.toString('utf8')
                .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/g, '')
                .replace(/(<meta name="hangout-(?:relay|turn|turnstile)" content=")[^"]*(">)/g, '$1$2')
                .replace(/<script[^>]*data-goatcounter[^>]*><\/script>/g, '')
                .replace('</head>', `<link rel="stylesheet" href="${PREFIX}/assets/preview.css"><script src="${PREFIX}/assets/session.js" data-session="${session.token}" data-profile="${session.profile}" data-label="${profile.label}" data-preview-nick="${profile.nick}"></script></head>`);
        }
        return send(res, 200, body, { 'Content-Type': MIME[path.extname(filePath)] }, head);
    });
    server.on('upgrade', (req, socket, head) => {
        const reject = () => socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
        if (!validHost(req) || req.headers.origin !== origin) return reject();
        const url = new URL(req.url, origin);
        const match = sessionRoute(url.pathname, 'relay');
        if (!match || !activeSession(match[1])) return reject();
        req.previewSession = activeSession(match[1]);
        req.deviceCookiePath = `${PREFIX}/relay/${match[1]}/`;
        url.pathname = match[2] || '/';
        if (!['/lobby', '/lobby-owner', '/lobby-admin', '/room'].includes(url.pathname)) return reject();
        relay.handleUpgrade(req, socket, head, url).catch(() => socket.destroy());
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
    try {
        relay = createHangoutRelay({
            previewKey: KEY,
            origins: origin,
            initialState: store.value.lobby,
            persist: (kind, value) => {
                if (kind === 'modlog') store.value.lobby.modlog = [...(store.value.lobby.modlog || []), value].filter((entry) => Date.now() - entry.at < LOG_TTL).slice(-2000);
                else store.value.lobby[kind] = value;
                store.write();
            },
            resolveIdentity: async (req, url) => {
                const session = req.previewSession;
                if (!session || !activeSession(session.token)) return null;
                const profile = PROFILES[session.profile];
                if (url.pathname === '/lobby') return { role: 'fan', account: '' };
                if (url.pathname === '/lobby-admin' && !['owner', 'moderator'].includes(profile.role)) return null;
                if (!profile.email) return null;
                return { role: profile.role, account: await accountId(profile.email, 'explicit-local-preview-account-key-0001') };
            }
        });
        await relay.settled();
        store.value.lobby.net = relay.lobby.snapshot();
        store.value.lobby.modlog = relay.lobby.modlog;
        store.write();
    } catch (error) { await relay?.close(); await new Promise((resolve) => server.close(resolve)); throw error; }
    return {
        origin, url: `${origin}${PREFIX}/`, statePath, address: server.address(),
        lobby: relay.lobby,
        close: async () => { await relay.close(); server.closeIdleConnections(); await new Promise((resolve) => server.close(resolve)); }
    };
}
