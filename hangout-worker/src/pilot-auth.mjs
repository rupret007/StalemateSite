// Authentication only for the separate protected pilot deployment; never used by the production entrypoint.
const encoder = new TextEncoder();
const encode = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
export const PILOT_TTL = 8 * 3600 * 1000;
export function equalSecret(a, b) {
    if (typeof b !== 'string' || b.length < 32) return false;
    a = typeof a === 'string' ? a : '';
    let difference = a.length ^ b.length;
    for (let i = 0; i < b.length; i++) difference |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i);
    return difference === 0;
}
export async function signPilot(kind, claims, secret) {
    const body = encode(encoder.encode(JSON.stringify(claims)));
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = encode(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${kind}:${body}`))));
    return `${body}.${signature}`;
}
export async function readPilot(kind, token, secret, now = Date.now()) {
    try {
        if (typeof secret !== 'string' || secret.length < 32 || !token || token.length > 2048) return null;
        const [body, signature, extra] = token.split('.');
        if (extra || !/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;
        const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
        if (!await crypto.subtle.verify('HMAC', key, decode(signature), encoder.encode(`${kind}:${body}`))) return null;
        const value = JSON.parse(new TextDecoder().decode(decode(body)));
        if (value.v !== 1 || !Number.isFinite(value.exp) || value.exp <= now || value.exp > now + PILOT_TTL || !/^[a-z0-9-]{16,64}$/.test(value.sid)) return null;
        return value;
    } catch { return null; }
}
export function cookieValue(request, name) {
    return (request.headers.get('Cookie') || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}
export function pilotCookie(name, token) { return `${name}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${PILOT_TTL / 1000}`; }
export async function pilotSession(request, env) {
    const access = await readPilot('access', cookieValue(request, '__Host-pilot'), env.HANGOUT_HMAC_KEY);
    if (!access || !['operator', 'guest'].includes(access.scope)) return null;
    const identity = await readPilot('identity', cookieValue(request, '__Host-pilot-identity'), env.HANGOUT_HMAC_KEY);
    if (identity && identity.sid === access.sid && access.scope === 'operator' && ['fan', 'room-owner', 'moderator', 'owner'].includes(identity.role) && /^[A-Za-z][A-Za-z0-9_-]{2,19}$/.test(identity.label)) return { access, identity };
    return { access, identity: { role: 'fan', label: 'Guest', exp: access.exp, sid: access.sid } };
}
