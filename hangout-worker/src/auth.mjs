// Admin auth = Cloudflare Access (free Zero Trust, email one-time code to the band allowlist set in the
// Cloudflare dashboard). We verify the Cf-Access-Jwt-Assertion header, never the cookie. No secrets in git:
// HANGOUT_ACCESS_TEAM and HANGOUT_ACCESS_AUD are public ids; the HMAC key lives in `wrangler secret`.
const enc = new TextEncoder();
const b64urlToBytes = (s) => {
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const bytesToB64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jsonPart = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

export function accessConfigured(env = {}) {
    return /^[a-z0-9-]+\.cloudflareaccess\.com$/.test(String(env.HANGOUT_ACCESS_TEAM || '')) && /^[a-f0-9]{32,128}$/.test(String(env.HANGOUT_ACCESS_AUD || ''));
}

// Returns {email} or throws. fetchJwks(url) -> {keys:[JWK]}; injected so tests never hit the network.
export async function verifyAccessJwt(token, { team, aud, now = Date.now(), fetchJwks }) {
    if (!token || typeof token !== 'string') throw new Error('missing');
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('malformed');
    let header;
    let claims;
    try { header = jsonPart(parts[0]); claims = jsonPart(parts[1]); } catch (error) { throw new Error('malformed'); }
    if (header.alg !== 'RS256') throw new Error('alg');
    let jwks;
    try { jwks = await fetchJwks(`https://${team}/cdn-cgi/access/certs`); }
    catch { throw new Error('jwks'); }
    const jwk = (jwks.keys || []).find((k) => k.kid === header.kid);
    if (!jwk) throw new Error('kid');
    let ok;
    try {
        const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
        ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
    } catch { throw new Error('crypto'); }
    if (!ok) throw new Error('signature');
    const t = Math.floor(now / 1000);
    if (claims.iss !== `https://${team}`) throw new Error('issuer');
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(aud)) throw new Error('audience');
    if (typeof claims.exp !== 'number' || claims.exp <= t) throw new Error('expired');
    if (typeof claims.nbf === 'number' && claims.nbf > t + 30) throw new Error('not-yet');
    // Match the beta identity bound before hashing/storing an issuer's claim.
    // A valid signature alone must not permit unbounded socket attachments.
    if (typeof claims.email !== 'string' || claims.email.length > 254 || enc.encode(claims.email).byteLength > 254 || !claims.email.includes('@')) throw new Error('email');
    return { email: claims.email.toLowerCase(), expiresAt: claims.exp * 1000 };
}

// Owner (Jeff) vs band op. Emails come from `wrangler secret`/vars, never the repo. Unknown Access email => band
// only if listed in HANGOUT_BAND_EMAILS; otherwise refused (defence in depth behind the Access policy).
export function roleForEmail(email, env = {}) {
    const list = (v) => String(v || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
    if (list(env.HANGOUT_OWNER_EMAIL).includes(email)) return 'owner';
    if (list(env.HANGOUT_BAND_EMAILS).includes(email)) return 'band';
    if (list(env.HANGOUT_MODERATOR_EMAILS).includes(email)) return 'moderator';
    return null;
}

async function hmac(keyText, msg) {
    const key = await crypto.subtle.importKey('raw', enc.encode(keyText), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return bytesToB64url(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
const safeEq = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    let d = a.length ^ b.length;
    for (let i = 0; i < b.length; i += 1) d |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i);
    return d === 0;
};
export const hmacKeyOk = (k) => typeof k === 'string' && k.length >= 32;

export function newDeviceId() {
    return bytesToB64url(crypto.getRandomValues(new Uint8Array(16)));
}
export async function signDevice(id, key) {
    return `${id}.${(await hmac(key, `dev:${id}`)).slice(0, 32)}`;
}
// Returns the device id if the token is genuine, else null (a forged id is simply a brand-new device).
export async function verifyDevice(token, key) {
    const m = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{32})$/.exec(String(token || ''));
    if (!m) return null;
    const want = (await hmac(key, `dev:${m[1]}`)).slice(0, 32);
    return safeEq(m[2], want) ? m[1] : null;
}
// Daily IP hash. No raw IP is ever stored.
export async function ipHash(ip, key, now = Date.now()) {
    return (await hmac(key, `ip:${ip}:${new Date(now).toISOString().slice(0, 10)}`)).slice(0, 22);
}

export async function accountId(email, key) { return `a_${await hmac(key, `account:${email.toLowerCase()}`)}`; }
