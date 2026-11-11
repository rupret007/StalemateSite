import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import { Miniflare, convertV4MiniflareOptions } from './durable-records/node_modules/miniflare/dist/src/index.js';

const origin = 'https://local-fixture.invalid';
const invite = 'local-arcade-fixture-invitation-2026';
const preview = 'local-arcade-fixture-preview-key-2026';
const nonce = randomBytes(16).toString('hex');
const room = '#game-2ca9e1x1be34a';
const browserName = process.argv[2]?.replace(/^--browser=/, '') || '';
const browserMedia = process.argv.includes('--media');
assert.ok(!browserMedia || browserName === 'chromium', 'the synthetic device media test uses Chromium');
assert.ok(['', 'chromium', 'webkit'].includes(browserName), 'choose --browser=chromium or --browser=webkit');
const evidence = process.env.ARCADE_BROWSER_EVIDENCE ? resolve(process.env.ARCADE_BROWSER_EVIDENCE) : null;
const app = fileURLToPath(new URL('../../', import.meta.url));
const assets = fileURLToPath(new URL('../../.beta-assets/', import.meta.url));
const sharedSource = process.env.ARCADE_TEST_SOURCE ? resolve(process.env.ARCADE_TEST_SOURCE) : null;
const radDad = process.env.ARCADE_TEST_RAD_DAD ? resolve(process.env.ARCADE_TEST_RAD_DAD) : null;
assert.equal(!!sharedSource, !!radDad, 'provide both arcade checkouts for the cross-site browser proof');
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
async function grant(guest, ref, path = '/beta/arcade-ticket') {
    const ticket = await call(path, guest.cookie, { actor: guest.id, room, ref });
    assert.equal(ticket.status, 200, await ticket.clone().text());
    return ticket.json();
}
function upgrade(cookie, { protocol, ticket }, path = '/beta/arcade-match') {
    return mf.dispatchFetch(origin + path, { headers: { ...base(cookie), Upgrade: 'websocket',
        'Sec-WebSocket-Protocol': `${protocol}, ${ticket}` } });
}
const pause = () => new Promise(resolve => setTimeout(resolve, 600));

async function serveAsset(request) {
    const name = decodeURIComponent(new URL(request.url).pathname);
    const file = resolve(assets, '.' + name + (name.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(assets.endsWith(sep) ? assets : assets + sep)) return new Response('Not found', { status: 404 });
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
    try { return new Response(await readFile(file), { headers: { 'Content-Type': mime[extname(file)] || 'application/octet-stream' } }); }
    catch { return new Response('Not found', { status: 404 }); }
}

async function previewEntrances(betaOrigin) {
    if (!sharedSource) return null;
    const receipt = await readFile(join(app, 'hangout-worker/arcade/VENDORED.txt'), 'utf8');
    const sha = /^Turdanoid@([a-f0-9]{40})\s*$/.exec(receipt)?.[1];
    assert.ok(sha, 'shared arcade source pin');
    const entries = {};
    for (const [brand, repository, script, url] of [
        ['stalemate', app, 'lib/sync-turdanoid.cjs', 'https://stalemate.band/play/'],
        ['rad-dad', radDad, 'sync-arcade.cjs', 'https://raddadband.com/play/']
    ]) {
        const stage = join(directory, brand);
        await mkdir(stage);
        await cp(join(repository, 'scripts'), join(stage, 'scripts'), { recursive: true });
        execFileSync(process.execPath, [join(stage, 'scripts', script), '--source', sharedSource, '--game-night', betaOrigin + '/beta/', sha],
            { cwd: stage, stdio: 'pipe' });
        entries[brand] = { url, html: await readFile(join(stage, 'play/index.html'), 'utf8') };
    }
    return entries;
}

async function verifyMedia(white, black, ref, matchA, matchB) {
    const endpoint = '/beta/game-night-media';
    const join = async player => {
        const ticket = await grant(player, ref, endpoint + '-ticket');
        const response = await upgrade(player.cookie, ticket, endpoint);
        assert.equal(response.status, 101);
        const media = observe(response.webSocket);
        await media.wait(frame => frame.t === 'media-ready', 'media admission');
        media.send({ version: 1, action: 'join' });
        const initial = await media.wait(frame => frame.t === 'media-room', 'call with tracks off');
        assert.deepEqual(initial.tracks, { audio: false, video: false });
        return media;
    };
    const wrongChannel = await upgrade(white.cookie, await grant(white, ref), endpoint);
    assert.equal(wrongChannel.status, 403);
    await wrongChannel.body?.cancel();
    const a = await join(white), b = await join(black);
    await a.wait(frame => frame.peers?.some(peer => peer.id === black.id), 'other call participant');
    const offer = { version: 1, action: 'signal', to: black.id,
        sdp: { type: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=sendonly\r\n' } };
    a.send(offer);
    await a.wait(frame => frame.t === 'media-error' && frame.reason === 'tracks-unavailable', 'unapproved send track refused');
    a.send({ version: 1, action: 'tracks', audio: true, video: false });
    await b.wait(frame => frame.peers?.some(peer => peer.id === white.id && peer.audio), 'explicit microphone consent');
    a.send(offer);
    const relayed = await b.wait(frame => frame.t === 'media-signal' && frame.from === white.id, 'targeted call offer');
    assert.deepEqual(relayed.sdp, offer.sdp);
    const attempt = b.frames.length;
    b.send({ version: 1, action: 'tracks', audio: false, video: true, adult18: true });
    await b.wait(frame => frame.t === 'media-error' && frame.reason === 'tracks-unavailable', 'default camera gate', attempt);
    a.send({ version: 1, action: 'camera-policy', on: true });
    await b.wait(frame => frame.cameraAllowed, 'host enabled camera choice');
    const ageCheck = b.frames.length;
    b.send({ version: 1, action: 'tracks', audio: false, video: true, adult18: false });
    await b.wait(frame => frame.t === 'media-error' && frame.reason === 'tracks-unavailable', 'adult eligibility required', ageCheck);
    b.send({ version: 1, action: 'tracks', audio: false, video: true, adult18: true });
    await a.wait(frame => frame.peers?.some(peer => peer.id === black.id && peer.video), 'opted-in adult camera');
    const cameraOff = b.frames.length;
    a.send({ version: 1, action: 'camera-policy', on: false });
    await b.wait(frame => frame.t === 'media-room' && !frame.cameraAllowed && !frame.tracks.video, 'host revoked camera', cameraOff);
    const blockAt = b.frames.length;
    white.lobby.send({ t: 'cmd', name: 'block', args: ['FixtureBlack'], ch: room,
        roomInstance: ref, personContext: 1, personPeer: black.id });
    await b.wait(frame => frame.peers?.length === 0, 'blocked peers removed from call', blockAt);
    const blocked = a.frames.length;
    a.send(offer);
    await a.wait(frame => frame.t === 'media-error' && frame.reason === 'peer-unavailable', 'blocked offer refused', blocked);
    const unblockAt = b.frames.length;
    white.lobby.send({ t: 'cmd', name: 'unblock', args: ['FixtureBlack'], ch: room,
        roomInstance: ref, personContext: 1, personPeer: black.id });
    await b.wait(frame => frame.peers?.some(peer => peer.id === white.id), 'unblocked peer restored to call', unblockAt);
    const before = b.frames.length;
    a.send({ version: 1, action: 'leave' });
    await b.wait(frame => frame.peers?.length === 0, 'call leave published', before);
    for (const other of [white.lobby, black.lobby, matchA, matchB]) assert.ok(other.frames.every(frame => frame.t !== 'media-signal'));
    b.send({ version: 1, action: 'leave' });
    console.log('Passed native separate call admission, receive-only default, microphone opt-in, adult camera controls and targeted signaling.');
}

try {
    runtime = await rolldown({ input: fileURLToPath(new URL('./lobby-session-authority/worker.mjs', import.meta.url)),
        platform: 'neutral', external: ['node:crypto'] });
    const bundled = await runtime.generate({ format: 'esm', codeSplitting: false });
    mf = new Miniflare(convertV4MiniflareOptions({
        name: 'private-arcade-fixture', rootPath: directory, modulesRoot: directory,
        modules: [{ type: 'ESModule', path: join(directory, 'worker.mjs'), contents: bundled.output[0].code }],
        compatibilityDate: '2026-10-01', host: '127.0.0.1', port: 0, https: !!browserName, telemetry: { enabled: false },
        durableObjects: { LOBBY: { className: 'FixtureLobby', useSQLite: true }, QUOTA: { className: 'HangoutQuota', useSQLite: true }, ROOMS: { className: 'HangoutRoom', useSQLite: true } },
        bindings: { FIXTURE_NONCE: nonce, HANGOUT_SESSION_AUTHORITY: 'lobby-v1', HANGOUT_BETA_MODE: 'protected', HANGOUT_ARCADE_CHESS: '1',
            ...(browserName ? { FIXTURE_ARCADE_BROWSER: '1' } : {}),
            ...(!browserName || browserMedia ? { HANGOUT_ARCADE_MEDIA: '1' } : {}),
            HANGOUT_HMAC_KEY: 'owned-arcade-fixture-hmac-not-for-deployment-2026', HANGOUT_BETA_INVITE_KEY: invite,
            HANGOUT_BETA_INVITE_VERSION: '1', HANGOUT_PREVIEW_KEY: preview, HANGOUT_OPEN: '1', HANGOUT_AI_ENABLED: '0', HANGOUT_TURN_ENABLED: '0' },
        ...(browserName ? { serviceBindings: { ASSETS: serveAsset } } : {}),
        outboundService: () => new Response('fixture egress denied', { status: 503 })
    }));
    await mf.ready;
    const initialized = await mf.dispatchFetch(origin + '/_fixture/initialize', {
        method: 'POST', headers: { 'X-Fixture-Nonce': nonce, 'Content-Type': 'application/json' }, body: '{}'
    });
    assert.equal(initialized.status, 200, await initialized.text());
    if (browserName) {
        const { runArcadeBrowser } = await import('./arcade-browser.mjs');
        const browserOrigin = (await mf.ready).origin;
        await runArcadeBrowser(browserName, browserOrigin, invite, evidence, await previewEntrances(browserOrigin), browserMedia);
    } else {
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
    await verifyMedia(white, black, ch.keepRef, a, returning);
    white.lobby.send({ t: 'say', ch: room, text: 'Good luck at Chess' });
    await black.lobby.wait(frame => frame.t === 'line' && frame.text === 'Good luck at Chess', 'chat while match is open');
    const partAt = a.frames.length;
    black.lobby.send({ t: 'cmd', name: 'part', args: [room], ch: room });
    await black.lobby.wait(frame => frame.t === 'part' && frame.ch === room, 'explicit room departure');
    await a.wait(frame => frame.t === 'match-state' && frame.state === null, 'seat retirement', partAt);
    console.log('Passed native private invitations, session-bound one-use grants, two-brand Chess move and chat, match reconnection, and explicit seat retirement.');
    }
} finally {
    await mf?.dispose();
    await runtime?.close();
    await rm(directory, { recursive: true, force: true });
}
