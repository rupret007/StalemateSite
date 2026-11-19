// The named issuer binding is available only to the protected Worker. This
// path never uses the public WebJam credential endpoint as a fallback.
export const MUSIC_PATH = '/beta/music';
export const MUSIC_INTERNAL_PATH = '/__private-music';
export const MUSIC_PURPOSE = 'private-music-turn-v1';
export const musicRef = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
export const musicDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function privateMusicOrigin(env) {
    if (env.HANGOUT_BETA_MODE !== 'protected' || env.HANGOUT_SESSION_AUTHORITY !== 'lobby-v1'
        || env.HANGOUT_PARTICIPATION_AUTHORITY !== 'c3-v1' || env.HANGOUT_OPEN === '0'
        || !['prepare', 'issue', 'revoke'].every(method => typeof env.WEBJAM_PRIVATE_MUSIC?.[method] === 'function')) return '';
    const origin = env.WEBJAM_WEB_ORIGINS;
    try { return new URL(origin).origin === origin && origin.startsWith('https://') ? origin : ''; }
    catch { return ''; }
}

export async function musicJson(request) {
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) return null;
    const reader = request.body?.getReader();
    if (!reader) return null;
    const chunks = new Uint8Array(1024);
    let size = 0, complete = false;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) { complete = true; break; }
            if (size + value.byteLength > chunks.length) return null;
            chunks.set(value, size);
            size += value.byteLength;
        }
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(chunks.subarray(0, size)));
        return value && Object.getPrototypeOf(value) === Object.prototype ? value : null;
    } catch { return null; }
    finally {
        if (!complete) void reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

export const musicResponse = (status, body) => Response.json(body, { status, headers: {
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff'
} });
