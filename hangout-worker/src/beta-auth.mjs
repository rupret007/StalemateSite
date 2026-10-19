// Real beta admission is separate from the pilot's synthetic test identities.
import { hmacKeyOk, roleForEmail } from './auth.mjs';
import { BETA_TTL, registryRequest } from './beta-session-client.mjs';
export { BETA_TTL } from './beta-session-client.mjs';

const enc = new TextEncoder();
const encode = (value) => btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (value) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
export const BETA_COOKIE = '__Host-hangout-beta';
export const BETA_IDENTITY_COOKIE = '__Host-hangout-beta-identity';

export function equalInvite(given, expected) {
    if (typeof expected !== 'string' || expected.length < 32) return false;
    const value = typeof given === 'string' ? given : '';
    let difference = value.length ^ expected.length;
    for (let i = 0; i < expected.length; i++) difference |= (value.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
    return difference === 0;
}

export async function signBeta(kind, claims, secret) {
    if (!hmacKeyOk(secret)) throw new Error('Beta signing is not configured.');
    const body = encode(enc.encode(JSON.stringify(claims)));
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return `${body}.${encode(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`beta:${kind}:${body}`))))}`;
}

export async function readBeta(kind, token, secret, now = Date.now()) {
    try {
        if (!hmacKeyOk(secret) || typeof token !== 'string' || token.length > 4096) return null;
        const [body, signature, extra] = token.split('.');
        if (extra || !/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;
        const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
        if (!await crypto.subtle.verify('HMAC', key, decode(signature), enc.encode(`beta:${kind}:${body}`))) return null;
        const claims = JSON.parse(new TextDecoder().decode(decode(body)));
        if (!claims || claims.v !== 1 || !/^[a-z0-9-]{16,64}$/.test(claims.sid) || !Number.isFinite(claims.exp) || claims.exp <= now || claims.exp > now + BETA_TTL) return null;
        return claims;
    } catch { return null; }
}

export function betaCookie(name, token, ttl = BETA_TTL) {
    // Access OTP returns through a top-level cross-site GET. Exact-Origin POST/WS checks prevent CSRF.
    return `${name}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(ttl / 1000))}`;
}

const cookie = (request, name) => (request.headers.get('Cookie') || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`))?.slice(name.length + 1) || '';

export class BetaSessionUnavailable extends Error {
    constructor(message, status = 503) { super(message); this.status = status; }
}
export async function betaSession(request, env, now = Date.now(), { allowRevoked = false } = {}) {
    const access = await readBeta('access', cookie(request, BETA_COOKIE), env.HANGOUT_HMAC_KEY, now);
    if (!access || access.scope !== 'guest' || access.version !== String(env.HANGOUT_BETA_INVITE_VERSION || '1')) return null;
    let checked;
    try { checked = await registryRequest(env, 'check', { sid: access.sid, exp: access.exp, version: access.version, allowRevoked }); }
    catch { throw new BetaSessionUnavailable('Beta session registry is unavailable.'); }
    if (checked.status === 403) return null;
    if (checked.status !== 200) throw new BetaSessionUnavailable('Beta session registry is unavailable.');
    const revoked = allowRevoked && (await checked.json()).reason === 'revoked';
    const identity = await readBeta('identity', cookie(request, BETA_IDENTITY_COOKIE), env.HANGOUT_HMAC_KEY, now);
    if (identity && identity.sid === access.sid && identity.exp <= access.exp && typeof identity.email === 'string' && identity.email.length <= 254) {
        if (identity.kind === 'owner') return { access, identity: { ...identity, role: 'fan' }, revoked };
        if (identity.kind === 'staff' && roleForEmail(identity.email, env) === identity.role) return { access, identity, revoked };
    }
    return { access, identity: null, revoked };
}

export async function readBetaBody(request) {
    const reader = request.body?.getReader();
    if (!reader) return null;
    let size = 0, value = '';
    const decoder = new TextDecoder();
    while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 2048) { await reader.cancel(); return null; }
        value += decoder.decode(chunk.value, { stream: true });
    }
    try {
        const body = JSON.parse(value + decoder.decode());
        return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
    } catch { return null; }
}
