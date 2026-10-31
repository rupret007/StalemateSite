// Pure relay rules shared by the Cloudflare Worker and the local dev/test relay.
// The relay never sees plaintext: frames are {iv, c} ciphertext from the browser.

const enc = new TextEncoder();

function b64u(bytes) {
    let s = '';
    bytes.forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const DEFAULTS = Object.freeze({
    maxPeers: 8,
    maxFrameBytes: 1024 * 1024,
    connectionsPerDay: 200,     // whole account, keeps Durable Object requests far below the free 100k/day
    messagesPerConnection: 8000,
    burst: 30,                  // token bucket per socket
    refillPerSecond: 8
});

export const ALLOWED_ORIGINS = Object.freeze(['https://stalemate.band', 'https://www.stalemate.band', 'https://rupret007.github.io']);

export function limitsFrom(env = {}) {
    const pick = (name, fallback) => {
        const n = Number(env[name]);
        return Number.isInteger(n) && n > 0 ? Math.min(n, fallback * 4) : fallback;
    };
    return {
        maxPeers: Math.min(pick('HANGOUT_MAX_PEERS', DEFAULTS.maxPeers), 12),
        maxFrameBytes: DEFAULTS.maxFrameBytes,
        connectionsPerDay: pick('HANGOUT_CONNECTIONS_PER_DAY', DEFAULTS.connectionsPerDay),
        messagesPerConnection: DEFAULTS.messagesPerConnection,
        burst: DEFAULTS.burst,
        refillPerSecond: DEFAULTS.refillPerSecond
    };
}

export function validRoomId(value) {
    return /^[0-9a-f]{64}$/.test(String(value || ''));
}

export function originAllowed(origin, extra = '') {
    const list = ALLOWED_ORIGINS.concat(String(extra || '').split(',').map((s) => s.trim()).filter(Boolean));
    return list.includes(String(origin || ''));
}

// Constant-time compare for the preview key (a Worker secret, never in the repo).
export function previewKeyOk(given, expected) {
    if (typeof expected !== 'string' || expected.length < 16) return false; // missing secret: fail closed
    const a = String(given || '');
    let diff = a.length ^ expected.length;
    for (let i = 0; i < expected.length; i += 1) diff |= (a.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
    return diff === 0;
}

/** Per-room relay token (HMAC). Lives in the invite #fragment, not the global preview query param. */
export async function roomRelayToken(previewKey, roomId) {
    if (typeof previewKey !== 'string' || previewKey.length < 16) return '';
    if (!validRoomId(roomId)) return '';
    const macKey = await crypto.subtle.importKey('raw', enc.encode(previewKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', macKey, enc.encode(`stalemate-hangout-relay-v1:${roomId}`));
    return b64u(new Uint8Array(sig));
}

export async function roomRelayTokenOk(given, roomId, previewKey) {
    const expected = await roomRelayToken(previewKey, roomId);
    if (!expected) return false;
    const a = String(given || '');
    let diff = a.length ^ expected.length;
    for (let i = 0; i < expected.length; i += 1) diff |= (a.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
    return diff === 0;
}

// Decide whether a WebSocket upgrade may proceed. Returns {status, reason} or null for OK.
export async function admit({ url, origin, env, extraOrigins, previewKey }) {
    if (!env || typeof env.HANGOUT_PREVIEW_KEY !== 'string' || !env.ROOMS || !env.QUOTA) {
        return { status: 503, reason: 'not-configured' };
    }
    if (!originAllowed(origin, extraOrigins)) return { status: 403, reason: 'origin' };
    if (url.searchParams.has('preview')) return { status: 403, reason: 'preview' };
    const room = url.searchParams.get('room');
    if (!validRoomId(room)) return { status: 400, reason: 'room' };
    if (previewKeyOk(previewKey, env.HANGOUT_PREVIEW_KEY)) return null;
    if (await roomRelayTokenOk(previewKey, room, env.HANGOUT_PREVIEW_KEY)) return null;
    return { status: 403, reason: 'preview' };
}

/** Preview gate secret travels in Sec-WebSocket-Protocol, never in the URL. */
export function previewKeyFromProtocols(header) {
    if (!header) return undefined;
    const token = String(header).split(',').map((s) => s.trim()).find(Boolean);
    return token || undefined;
}

export async function takeConnectionQuota(env) {
    try {
        const res = await env.QUOTA.get(env.QUOTA.idFromName('global')).fetch('https://quota/take', { method: 'POST' });
        return res.status;
    } catch (error) {
        return 503;
    }
}

export function validFrame(raw, limits = DEFAULTS) {
    if (typeof raw !== 'string' || raw.length > limits.maxFrameBytes) return null;
    let frame;
    try { frame = JSON.parse(raw); } catch (error) { return null; }
    if (!frame || typeof frame.iv !== 'string' || typeof frame.c !== 'string') return null;
    if (!/^[A-Za-z0-9_-]{16}$/.test(frame.iv) || !/^[A-Za-z0-9_-]+$/.test(frame.c)) return null;
    return { iv: frame.iv, c: frame.c };
}

export function bucketStateFromAttachment(attachment) {
    if (!attachment || typeof attachment !== 'object') return null;
    const { tokens, last, total } = attachment;
    if (!Number.isFinite(tokens) || !Number.isFinite(last) || !Number.isFinite(total)) return null;
    if (tokens < 0 || total < 0) return null;
    return { tokens, last, total };
}

export function createBucket(limits = DEFAULTS, now = () => Date.now(), initial = null) {
    let tokens = initial?.tokens ?? limits.burst;
    let last = initial?.last ?? now();
    let total = initial?.total ?? 0;
    return {
        take() {
            const t = now();
            tokens = Math.min(limits.burst, tokens + ((t - last) / 1000) * limits.refillPerSecond);
            last = t;
            total += 1;
            if (total > limits.messagesPerConnection) return 'spent';
            if (tokens < 1) return 'slow';
            tokens -= 1;
            return 'ok';
        },
        snapshot() {
            return { tokens, last, total };
        },
        get total() { return total; }
    };
}

export function dayKey(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}
