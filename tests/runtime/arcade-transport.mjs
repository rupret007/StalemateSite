import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import { Miniflare, convertV4MiniflareOptions } from './durable-records/node_modules/miniflare/dist/src/index.js';

const origin = 'https://local-fixture.invalid';
const invite = 'local-arcade-fixture-invitation-2026';
const preview = 'local-arcade-fixture-preview-key-2026';
const nonce = randomBytes(16).toString('hex');
const room = '#game-2ca9e1x1be34a';
const directory = await mkdtemp(join(tmpdir(), 'game-night-arcade-'));
let mf, runtime;

function observe(socket) {
    const frames = [];
    let ended, receive;
    socket.addEventListener('message', event => { frames.push(JSON.parse(event.data)); receive?.(); });
    socket.addEventListener('close', event => { ended = event.code; receive?.(); });
    socket.accept();
    return {
        socket, frames,
        send: value => socket.send(JSON.stringify(value)),
        wait: (predicate, label, start = 0) => new Promise((resolve, reject) => {
            const timer = setTimeout(() => { receive = null; reject(Error('Missing ' + label + ' ' +
                JSON.stringify(frames.slice(-4).map(({ t, reason, text }) => ({ t, reason, text }))))); }, 6000);
            receive = () => {
                const found = frames.slice(start).find(predicate);
                if (found || ended) { clearTimeout(timer); receive = null; found ? resolve(found) : reject(Error('Socket ended: ' + ended)); }
            };
            receive();
        })
    };
}
const base = (cookie = '', ip = '192.0.2.11') => ({ Origin: origin, 'X-Fixture-Nonce': nonce, 'CF-Connecting-IP': ip,
    ...(cookie ? { Cookie: cookie } : {}) });
const call = (path, cookie, payload, ip) => mf.dispatchFetch(origin + path, {
    headers: { ...base(cookie, ip), 'Content-Type': 'application/json' }, method: 'POST', body: JSON.stringify(payload)
});
async function guest(nick, entrySource, ip) {
    const unlocked = await call('/beta/unlock', '', { key: invite }, ip);
    assert.equal(unlocked.status, 200, await unlocked.clone().text());
    const cookie = unlocked.headers.get('Set-Cookie').split(';')[0];
    await unlocked.body?.cancel();
    const connected = await mf.dispatchFetch(origin + '/lobby?preview=' + preview, { headers: { ...base(cookie, ip), Upgrade: 'websocket' } });
    assert.equal(connected.status, 101);
    const lobby = observe(connected.webSocket);
    await lobby.wait(frame => frame.t === 'hello', 'lobby hello');
    lobby.send({ t: 'hello', nick, age13: true, entrySource });
    const { id } = await lobby.wait(frame => frame.t === 'welcome', 'lobby identity');
    await lobby.wait(frame => frame.t === 'join' && frame.ch.name === '#stalemate', 'lobby admission');
    return { lobby, cookie, id };
}
async function grant(guest, ref) {
    const ticket = await call('/beta/arcade-ticket', guest.cookie, { actor: guest.id, room, ref });
    assert.equal(ticket.status, 200, await ticket.clone().text());
    return ticket.json();
}
function upgrade(cookie, { protocol, ticket }) {
    return mf.dispatchFetch(origin + '/beta/arcade-match', { headers: { ...base(cookie), Upgrade: 'websocket',
        'Sec-WebSocket-Protocol': `${protocol}, ${ticket}` } });
}
const pause = () => new Promise(resolve => setTimeout(resolve, 600));

try {
    runtime = await rolldown({ input: fileURLToPath(new URL('./lobby-session-authority/worker.mjs', import.meta.url)),
        platform: 'neutral', external: ['node:crypto'] });
    const bundled = await runtime.generate({ format: 'esm', codeSplitting: false });
    mf = new Miniflare(convertV4MiniflareOptions({
        name: 'private-arcade-fixture', rootPath: directory, modulesRoot: directory,
        modules: [{ type: 'ESModule', path: join(directory, 'worker.mjs'), contents: bundled.output[0].code }],
        compatibilityDate: '2026-10-01', host: '127.0.0.1', port: 0, telemetry: { enabled: false },
        durableObjects: { LOBBY: { className: 'FixtureLobby', useSQLite: true }, QUOTA: { className: 'HangoutQuota', useSQLite: true }, ROOMS: { className: 'HangoutRoom', useSQLite: true } },
        bindings: { FIXTURE_NONCE: nonce, HANGOUT_SESSION_AUTHORITY: 'lobby-v1', HANGOUT_BETA_MODE: 'protected', HANGOUT_ARCADE_CHESS: '1',
            HANGOUT_HMAC_KEY: 'owned-arcade-fixture-hmac-not-for-deployment-2026', HANGOUT_BETA_INVITE_KEY: invite,
            HANGOUT_BETA_INVITE_VERSION: '1', HANGOUT_PREVIEW_KEY: preview, HANGOUT_OPEN: '1', HANGOUT_AI_ENABLED: '0', HANGOUT_TURN_ENABLED: '0' },
        outboundService: () => new Response('fixture egress denied', { status: 503 })
    }));
    await mf.ready;
    const initialized = await mf.dispatchFetch(origin + '/_fixture/initialize', {
        method: 'POST', headers: { 'X-Fixture-Nonce': nonce, 'Content-Type': 'application/json' }, body: '{}'
    });
    assert.equal(initialized.status, 200, await initialized.text());
    const white = await guest('FixtureWhite', 'stalemate', '192.0.2.11');
    const black = await guest('FixtureBlack', 'rad-dad', '192.0.2.12');
    white.lobby.send({ t: 'cmd', name: 'join', args: [room], ch: '#stalemate' });
    const { ch } = await white.lobby.wait(frame => frame.t === 'join' && frame.ch.name === room, 'private game room');
    assert.equal(ch.modes.i, true);
    const denied = await call('/beta/arcade-ticket', black.cookie, { actor: white.id, room, ref: ch.keepRef });
    assert.equal(denied.status, 403);
    await denied.body?.cancel();
    await pause();
    white.lobby.send({ t: 'cmd', name: 'invite', args: ['FixtureBlack', room], ch: room,
        roomInstance: ch.keepRef, personContext: 1, personPeer: black.id });
    await black.lobby.wait(frame => frame.t === 'invite' && frame.ch === room, 'person-bound invitation');
    black.lobby.send({ t: 'cmd', name: 'join', args: [room], ch: '#stalemate' });
    await black.lobby.wait(frame => frame.t === 'join' && frame.ch.name === room, 'invited guest membership');
    const ticket = await grant(white, ch.keepRef);
    const wrong = await upgrade(black.cookie, ticket);
    assert.equal(wrong.status, 403);
    await wrong.body?.cancel();
    const response = await upgrade(white.cookie, ticket);
    assert.equal(response.status, 101, response.status === 101 ? '' : await response.text());
    const a = observe(response.webSocket);
    const replay = await upgrade(white.cookie, ticket);
    assert.equal(replay.status, 403);
    await replay.body?.cancel();
    const other = await upgrade(black.cookie, await grant(black, ch.keepRef));
    assert.equal(other.status, 101);
    const b = observe(other.webSocket);
    await a.wait(frame => frame.t === 'match-ready', 'match upgrade');
    a.send({ version: 1, action: 'open' });
    const opened = await b.wait(frame => frame.t === 'match-state' && frame.state?.waiting, 'opponent sees open match');
    b.send({ version: 1, action: 'join', id: opened.state.id });
    const started = await a.wait(frame => frame.t === 'match-state' && frame.state?.match, 'joined match');
    a.send({ version: 1, action: 'move', id: started.state.id, revision: 0, move: 'e2e4' });
    const moved = await b.wait(frame => frame.state?.match?.moves?.[0] === 'e2e4', 'cross-site move');
    assert.equal(moved.state.seat, 'b');
    b.socket.close(1000, 'fixture reconnect');
    const resumed = await upgrade(black.cookie, await grant(black, ch.keepRef));
    assert.equal(resumed.status, 101);
    const returning = observe(resumed.webSocket);
    await returning.wait(frame => frame.t === 'match-ready', 'match reconnected');
    returning.send({ version: 1, action: 'sync' });
    const synced = await returning.wait(frame => frame.state?.match?.moves?.[0] === 'e2e4', 'restored board');
    assert.equal(synced.state.seat, 'b');
    white.lobby.send({ t: 'say', ch: room, text: 'Good luck at Chess' });
    await black.lobby.wait(frame => frame.t === 'line' && frame.text === 'Good luck at Chess', 'chat while match is open');
    black.lobby.send({ t: 'cmd', name: 'part', args: [room], ch: room });
    await black.lobby.wait(frame => frame.t === 'part' && frame.ch === room, 'explicit room departure');
    await a.wait(frame => frame.t === 'match-state' && frame.state === null, 'seat retirement');
    console.log('Passed native private invitations, session-bound one-use grants, two-brand Chess move and chat, match reconnection, and explicit seat retirement.');
} finally {
    await mf?.dispose();
    await runtime?.close();
    await rm(directory, { recursive: true, force: true });
}
