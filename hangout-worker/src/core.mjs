// Pure relay rules shared by the Cloudflare Worker and the local dev/test relay.
// The relay never sees plaintext: frames are {iv, c} ciphertext from the browser.

export const DEFAULTS = Object.freeze({
    maxPeers: 8,
    maxFrameBytes: 48 * 1024,
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

// Decide whether a WebSocket upgrade may proceed. Returns {status, reason} or null for OK.
export function admit({ url, origin, env, extraOrigins }) {
    if (!env || typeof env.HANGOUT_PREVIEW_KEY !== 'string' || !env.ROOMS || !env.QUOTA) {
        return { status: 503, reason: 'not-configured' };
    }
    if (!originAllowed(origin, extraOrigins)) return { status: 403, reason: 'origin' };
    if (!previewKeyOk(url.searchParams.get('preview'), env.HANGOUT_PREVIEW_KEY)) return { status: 403, reason: 'preview' };
    if (!validRoomId(url.searchParams.get('room'))) return { status: 400, reason: 'room' };
    return null;
}

export function validFrame(raw, limits = DEFAULTS) {
    if (typeof raw !== 'string' || raw.length > limits.maxFrameBytes) return null;
    let frame;
    try { frame = JSON.parse(raw); } catch (error) { return null; }
    if (!frame || typeof frame.iv !== 'string' || typeof frame.c !== 'string') return null;
    if (!/^[A-Za-z0-9_-]{16}$/.test(frame.iv) || !/^[A-Za-z0-9_-]+$/.test(frame.c)) return null;
    return { iv: frame.iv, c: frame.c };
}

export function createBucket(limits = DEFAULTS, now = () => Date.now()) {
    let tokens = limits.burst;
    let last = now();
    let total = 0;
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
        get total() { return total; }
    };
}

export function dayKey(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}
