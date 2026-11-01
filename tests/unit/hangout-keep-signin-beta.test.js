// @vitest-environment node
// Actual gateway + BetaSessions registry + lobby engine. Binding transports and
// the remote IdP are fixtures; RSA proof is real. This is not hosted email/OTP.
import { beforeAll, describe, expect, it } from 'vitest';
import { betaFetch } from '../../hangout-worker/src/beta-entry.mjs';
import { BetaSessions } from '../../hangout-worker/src/beta-sessions.mjs';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';
import { accountId } from '../../hangout-worker/src/auth.mjs';
import { keepRoomIntent, consumeKeepRoomIntent, KEEP_ROOM_INTENT_KEY } from '../../r/45662413410ed051/entry-sites.mjs';

const origin = 'https://keep.fixture.test', team = 'keep-test.cloudflareaccess.com';
const invite = 'keep-only-synthetic-invitation-'.repeat(2), preview = 'keep-only-synthetic-preview-'.repeat(2);
const secret = 'keep-only-synthetic-signing-key-'.repeat(2), aud = 'a'.repeat(64);
let pair, jwk;
beforeAll(async () => {
    pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'keep-test' };
});
async function proof(email, audience = aud) {
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const body = `${encode({ alg: 'RS256', kid: jwk.kid })}.${encode({ iss: `https://${team}`, aud: [audience], exp: Date.now() / 1000 + 600, email })}`;
    return `${body}.${Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(body))).toString('base64url')}`;
}
const cookieOf = response => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
function fixture() {
    const frames = [], lobby = createLobby({ send: (id, frame) => frames.push({ id, ...frame }), limits: { defaultSlow: 0 } });
    const env = { HANGOUT_BETA_MODE: 'protected', HANGOUT_BETA_INVITE_KEY: invite, HANGOUT_BETA_INVITE_VERSION: '1', HANGOUT_HMAC_KEY: secret,
        HANGOUT_PREVIEW_KEY: preview, HANGOUT_ACCESS_TEAM: team, HANGOUT_OWNER_ACCESS_AUD: aud, HANGOUT_ACCESS_AUD: 'b'.repeat(64),
        ASSETS: { fetch: async () => new Response('fixture assets') }, QUOTA: { idFromName: name => name, get: () => ({ fetch: async () => new Response('ok') }) },
        ROOMS: { idFromName: name => name, get: () => ({ fetch: async () => new Response('closed') }) },
        LOBBY: { idFromName: name => name, get: () => ({ fetch: async request => {
            if (new URL(request.url).pathname === '/__beta/disconnect') {
                const { betaSid: sid } = JSON.parse(request.headers.get('X-Hangout-Identity'));
                for (const c of [...lobby._debug.conns.values()]) if (c.betaSid === sid) lobby.disconnect(c.id);
                return new Response('closed');
            }
            return Response.json(JSON.parse(request.headers.get('X-Hangout-Identity')));
        } }) } };
    const values = new Map(), storage = { get: async key => values.get(key), put: async (key, value) => values.set(key, structuredClone(value)),
        list: async ({ prefix, limit }) => new Map([...values].filter(([key]) => key.startsWith(prefix)).slice(0, limit)),
        delete: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key); }, setAlarm: async () => {}, deleteAlarm: async () => {} };
    storage.transaction = async fn => fn(storage); // Success-path composition; rollback has the existing SQLite suites.
    const registry = new BetaSessions({ storage, blockConcurrencyWhile: fn => fn() }, env);
    env.BETA_SESSIONS = { idFromName: name => name, get: () => registry };
    const request = (path, { cookie, token, body, upgrade } = {}) => new Request(origin + path, { method: body ? 'POST' : 'GET',
        headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(token ? { 'Cf-Access-Jwt-Assertion': token } : {}),
            ...(body ? { 'Content-Type': 'application/json' } : {}), ...(upgrade ? { Upgrade: 'websocket' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const call = (path, options) => betaFetch(request(path, options), env, { fetchJwks: async () => ({ keys: [jwk] }) });
    const unlock = async () => cookieOf(await call('/beta/unlock', { body: { key: invite } }));
    const connect = async (id, nick, cookie, token, device = '') => {
        const result = await call(`/${token ? 'lobby-owner' : 'lobby'}?${new URLSearchParams({ preview, ...(device ? { dev: device } : {}) })}`, { cookie, token, upgrade: true });
        expect(result.status).toBe(200); // Transport seam returns the actual gateway's trusted identity, not a 101 socket.
        const identity = await result.json(); lobby.connect({ id, ...identity });
        lobby.message(id, JSON.stringify({ t: 'hello', nick, age13: true, entrySource: 'rad-dad' }));
        return identity;
    };
    const command = (id, name, args, ch = '#stalemate', roomInstance) => lobby.message(id, JSON.stringify({ t: 'cmd', name, args, ch, ...(roomInstance ? { roomInstance } : {}) }));
    return { env, lobby, frames, call, unlock, connect, command };
}

describe('signed email proof returning to the original temporary room', () => {
    it('revokes the guest SID, keeps the same signed founder device and explicitly registers the exact surviving room', async () => {
        const f = fixture(), guestCookie = await f.unlock();
        const guest = await f.connect('founder', 'Founder', guestCookie);
        f.command('founder', 'join', ['#keep-together']);
        const room = f.lobby._debug.channels.get('#keep-together'), ref = room.keepRef;
        const waitingCookie = await f.unlock(); await f.connect('waiting', 'Waiting', waitingCookie);
        f.command('waiting', 'join', [room.name]);
        const values = new Map([[KEEP_ROOM_INTENT_KEY, keepRoomIntent(room)]]);
        const token = await proof('founder@example.test'), login = await f.call('/lobby-owner/login?entry-return=1', { cookie: guestCookie, token });
        expect(login.status).toBe(303); expect(login.headers.get('Location')).toContain('owner=1&entry-return=1');
        expect((await f.call('/beta/state', { cookie: guestCookie })).status).toBe(401);
        const signedIn = cookieOf(login), returned = await f.connect('returned', 'Returned', signedIn, token, guest.devToken);
        expect(returned.dev).toBe(guest.dev);
        expect(returned.account).toBe(await accountId('founder@example.test', secret));
        expect(returned).toMatchObject({ role: 'fan', admin: false });
        const { intent } = consumeKeepRoomIntent({ getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key) });
        f.command('returned', 'join', [intent.room], '#stalemate', intent.ref);
        expect(room.keepRef).toBe(ref); expect(room.owner).toBe('');
        expect(f.frames.filter(frame => frame.id === 'returned' && frame.t === 'join').at(-1).ch.keepRef).toBe(ref);
        f.command('returned', 'register', [], intent.room, intent.ref);
        expect(room.owner).toBe(returned.account);
        expect(consumeKeepRoomIntent({ getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key) }).intent).toBeNull();
    });
    it('refuses the staff audience on the ordinary-owner callback without replacing the admitted guest identity', async () => {
        const f = fixture(), cookie = await f.unlock(), token = await proof('founder@example.test', 'b'.repeat(64));
        expect((await f.call('/lobby-owner/login?entry-return=1', { cookie, token })).status).toBe(403);
        expect(await (await f.call('/beta/state', { cookie })).json()).toMatchObject({ kind: 'guest', role: 'fan' });
    });
});
