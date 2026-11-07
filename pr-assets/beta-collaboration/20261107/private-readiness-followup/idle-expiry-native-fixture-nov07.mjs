// Owned loopback-only QA fixture. Never deployed or used with real credentials.
import { betaFetch, HangoutLobby, HangoutRoom, HangoutQuota, BetaSessions } from './hangout-worker/src/beta-entry.mjs';
import { BETA_TTL, BETA_COOKIE, betaCookie, signBeta } from './hangout-worker/src/beta-auth.mjs';
import { registryRequest } from './hangout-worker/src/beta-session-client.mjs';
import { ipHash } from './hangout-worker/src/auth.mjs';
export { HangoutRoom, HangoutQuota, BetaSessions };
const ORIGIN = 'https://local-fixture.invalid';
const admitted = (r, e) => new URL(r.url).origin === ORIGIN && r.headers.get('X-Fixture-Nonce') === e.FIXTURE_NONCE;
export class FixtureLobby extends HangoutLobby {
    async fetch(request) {
        if (new URL(request.url).pathname === '/_fixture/alarm') {
            if (!admitted(request, this.env) || request.method !== 'GET') return new Response('denied', { status: 403 });
            await this.ready;
            return Response.json({ alarm: await this.state.storage.getAlarm() });
        }
        return super.fetch(request);
    }
}
export default { async fetch(request, env) {
    if (!admitted(request, env) || request.headers.get('Origin') !== ORIGIN) return new Response('denied', { status: 403 });
    const path = new URL(request.url).pathname;
    if (path === '/_fixture/short-access' && request.method === 'POST') {
        // Only synthetic fixture issuance is shortened; application TTL/source is unmodified.
        const access = { v: 1, sid: crypto.randomUUID(), exp: Date.now() + 10000, scope: 'guest', version: '1' };
        const registered = await registryRequest(env, 'register', { sid: access.sid, exp: access.exp, version: access.version,
            iph: await ipHash('192.0.2.44', env.HANGOUT_HMAC_KEY) });
        if (registered.status !== 200) return new Response('registration refused', { status: 503 });
        return Response.json({ expiresAt: access.exp, productionTtlMs: BETA_TTL }, { headers: {
            'Set-Cookie': betaCookie(BETA_COOKIE, await signBeta('access', access, env.HANGOUT_HMAC_KEY), 10000)
        } });
    }
    if (path === '/_fixture/alarm' && request.method === 'GET')
        return env.LOBBY.get(env.LOBBY.idFromName('stalemate')).fetch(request);
    if (!['/beta/unlock', '/beta/state', '/beta/logout', '/join/app.js', '/lobby'].includes(path)) return new Response('denied', { status: 403 });
    return betaFetch(request, { ...env, ASSETS: { fetch: () => new Response('fixture assets not requested', { status: 404 }) } });
} };
