export { MUSIC_PURPOSE, browserMusicHostOp, equalMusicProof, musicDigest, musicRef,
    musicResponse, nativeMusicOp, stoppingMusic, validMusicBody } from './lobby-core.mjs';

// The named issuer binding is available only to the protected Worker. This
// path never uses the public WebJam credential endpoint as a fallback.
export const MUSIC_PATH = '/beta/music';
export const MUSIC_INTERNAL_PATH = '/__private-music';

export function nativeMusicRateAddress(ip) {
    if (typeof ip !== 'string' || !/^[0-9a-f:.]{2,45}$/i.test(ip)) return '';
    if (!ip.includes(':')) return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) && ip.split('.').every(part => Number(part) <= 255) ? ip : '';
    try {
        const canonical = new URL(`https://[${ip}]/`).hostname.slice(1, -1);
        const [start, end] = canonical.split('::');
        const head = start ? start.split(':') : [], tail = end ? end.split(':') : [];
        const parts = end === undefined ? head : [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail];
        return parts.slice(0, 4).join(':') + '/64';
    } catch { return ''; }
}

export function privateMusicOrigin(env) {
    if (env.HANGOUT_BETA_MODE !== 'protected' || env.HANGOUT_SESSION_AUTHORITY !== 'lobby-v1'
        || env.HANGOUT_PARTICIPATION_AUTHORITY !== 'c3-v1' || env.HANGOUT_OPEN === '0'
        || !['prepare', 'issue', 'touch', 'revoke'].every(method => typeof env.WEBJAM_PRIVATE_MUSIC?.[method] === 'function')) return '';
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
