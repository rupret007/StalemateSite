// Real betaFetch/BetaSessions and loopback lobby engine; in-memory storage and
// gateway-to-engine upgrade are fixtures. Not Cloudflare or hibernation proof.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { betaFetch, BetaSessions } from '../../../hangout-worker/src/beta-entry.mjs';
import { BETA_COOKIE } from '../../../hangout-worker/src/beta-auth.mjs';
import { createHangoutRelay } from '../../../scripts/hangout-relay-dev.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

export async function privateCommunity() {
    // Reuse only Miniflare's already-public development TLS pair, with its MIT
    // notice/provenance, rather than installing its runtime for a browser test.
    // Never mint, log or install a certificate or trust root.
    const tlsBytes = await readFile(new URL('../fixtures/public-miniflare-development-tls/tls.json', import.meta.url));
    assert.equal(createHash('sha256').update(tlsBytes).digest('hex'),
        'f5a8debf3c77cc48655be93b4076f397f4c5517b207dc9712a1e736f38fe4071');
    const { key, cert } = JSON.parse(tlsBytes);
    const records = new Map(), sockets = new Set(), admittedSockets = new Map(), failures = [];
    const storage = {
        get: async key => structuredClone(records.get(key)),
        put: async (key, value) => records.set(key, structuredClone(value)),
        delete: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) records.delete(key); },
        list: async ({ prefix = '', limit = 1000 } = {}) => new Map([...records]
            .filter(([key]) => key.startsWith(prefix)).slice(0, limit)),
        setAlarm: async () => {}, deleteAlarm: async () => {},
        transaction: callback => callback(storage)
    };
    const stub = { idFromName: name => name, get: () => ({ fetch: async () => new Response('fixture only') }) };
    const assetsRoot = resolve(root, '.beta-assets');
    const env = {
        HANGOUT_BETA_MODE: 'protected', HANGOUT_HMAC_KEY: 'h'.repeat(40),
        HANGOUT_BETA_INVITE_KEY: 'i'.repeat(40), HANGOUT_PREVIEW_KEY: 'p'.repeat(40),
        LOBBY: stub, ROOMS: stub, QUOTA: stub,
        ASSETS: { async fetch(request) {
            const pathname = new URL(request.url).pathname;
            const file = resolve(assetsRoot, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
            assert(file.startsWith(assetsRoot + sep), 'Asset escaped the private package');
            try { return new Response(await readFile(file), { headers: { 'Content-Type': types[extname(file)] || 'application/octet-stream' } }); }
            catch (error) { if (error.code === 'ENOENT') return new Response('Missing asset', { status: 404 }); throw error; }
        } }
    };
    const registry = new BetaSessions({ storage, blockConcurrencyWhile: callback => callback() }, env);
    env.BETA_SESSIONS = { idFromName: name => name, get: () => registry };
    const outbound = { fetch: () => assert.fail('Outbound fixture request denied') };
    let origin, admittedUpgrades = 0, refusedUpgrades = 0, interruptions = 0;
    const server = createServer({ key, cert }, async (incoming, response) => {
        try {
            const parts = []; let bytes = 0;
            for await (const part of incoming) {
                bytes += part.length; assert(bytes <= 16384, 'Fixture request body exceeded bound'); parts.push(part);
            }
            const request = new Request(origin + incoming.url, {
                method: incoming.method, headers: incoming.headers,
                body: parts.length ? Buffer.concat(parts) : undefined
            });
            const result = await betaFetch(request, env, outbound);
            response.statusCode = result.status;
            for (const [key, value] of result.headers) if (key !== 'set-cookie') response.setHeader(key, value);
            const cookies = result.headers.getSetCookie();
            if (cookies.length) response.setHeader('Set-Cookie', cookies);
            response.end(Buffer.from(await result.arrayBuffer()));
        } catch (error) { failures.push(error.name); response.writeHead(500).end('Local fixture error'); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    origin = 'https://127.0.0.1:' + server.address().port;
    const relay = createHangoutRelay({ origins: origin, previewKey: env.HANGOUT_PREVIEW_KEY });
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    server.on('upgrade', async (incoming, socket, head) => {
        try {
            const result = await betaFetch(new Request(origin + incoming.url, { headers: incoming.headers }), {
                ...env, LOBBY: { idFromName: name => name, get: () => ({ fetch: async request => {
                    assert.equal(JSON.parse(request.headers.get('X-Hangout-Identity')).role, 'fan');
                    return new Response(null, { status: 204 });
                } }) }
            }, outbound);
            if (result.status !== 204) {
                refusedUpgrades++; socket.end('HTTP/1.1 ' + result.status + ' Refused\r\n\r\n'); return;
            }
            admittedUpgrades++;
            const cookie = String(incoming.headers.cookie || '').split(/;\s*/)
                .find(value => value.startsWith(BETA_COOKIE + '='))?.slice(BETA_COOKIE.length + 1);
            assert(cookie, 'Admitted fixture upgrade must have its private session cookie');
            const session = createHash('sha256').update(cookie).digest('hex');
            const connections = admittedSockets.get(session) || new Set();
            connections.add(socket); admittedSockets.set(session, connections);
            socket.once('close', () => { connections.delete(socket); if (!connections.size) admittedSockets.delete(session); });
            await relay.handleUpgrade(incoming, socket, head, new URL(incoming.url, origin));
        } catch (error) { failures.push(error.name); socket.destroy(); }
    });
    return {
        origin, invitation: env.HANGOUT_BETA_INVITE_KEY, sessionCookieName: BETA_COOKIE,
        interruptGuest(cookie) {
            assert.equal(typeof cookie, 'string', 'Fixture interruption needs an owned session');
            const session = createHash('sha256').update(cookie).digest('hex');
            const connections = [...(admittedSockets.get(session) || [])].filter(socket => !socket.destroyed);
            assert.equal(connections.length, 1, 'Interrupt exactly one owned admitted chat connection');
            interruptions++; connections[0].destroy();
        },
        diagnostics: () => ({ admittedUpgrades, refusedUpgrades, interruptions, failures: [...failures], storage: 'in-memory fixture',
            scope: 'HTTPS beta admission and asset gate; upgrade-to-engine bridge fixture. No live-cookie, restart or existing-socket revocation proof.' }),
        async close() {
            await relay.close();
            const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
            for (const socket of sockets) socket.destroy();
            await closed;
        }
    };
}
