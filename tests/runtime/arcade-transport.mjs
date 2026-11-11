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

async function verifyEights(white, black, ref, chess) {
    const ticketPath = '/beta/arcade-crapeights-ticket', matchPath = '/beta/arcade-crapeights-match';
    const guestTicket = await grant(white, ref, ticketPath);
    const wrongGame = await upgrade(white.cookie, guestTicket);
    assert.equal(wrongGame.status, 403, 'an Eights grant cannot upgrade a Chess socket');
    await wrongGame.body?.cancel();
    async function connect(player, ticket) {
        const response = await upgrade(player.cookie, ticket || await grant(player, ref, ticketPath), matchPath);
        assert.equal(response.status, 101);
        const link = observe(response.webSocket);
        await link.wait(frame => frame.t === 'match-ready', 'Eights ready');
        return link;
    }
    const a = await connect(white, guestTicket), b = await connect(black);
    const spectator = await guest('FixtureWatcher', 'rad-dad', '192.0.2.13');
    await pause();
    white.lobby.send({ t: 'cmd', name: 'invite', args: ['FixtureWatcher', room], ch: room,
        roomInstance: ref, personContext: 1, personPeer: spectator.id });
    await spectator.lobby.wait(frame => frame.t === 'invite' && frame.ch === room, 'watcher invitation');
    spectator.lobby.send({ t: 'cmd', name: 'join', args: [room], ch: '#stalemate' });
    await spectator.lobby.wait(frame => frame.t === 'join' && frame.ch.name === room, 'watcher admission');
    const watch = await connect(spectator);
    a.send({ version: 1, action: 'open' });
    const open = await b.wait(frame => frame.state?.waiting, 'Eights open');
    const id = open.state.id;
    b.send({ version: 1, action: 'join', id });
    const dealt = [a, b, watch].map(link => link.wait(frame => frame.state?.match?.revision === 0, 'Eights deal'));
    const [av, bv, wv] = (await Promise.all(dealt)).map(frame => frame.state.match);
    assert.equal(av.hand.length, 7);
    assert.equal(bv.hand.length, 7);
    assert.deepEqual(wv.hand, []);
    assert.deepEqual(wv.counts, { a: 7, b: 7 });
    assert.equal(av.hand.some(card => bv.hand.some(other => card.id === other.id)), false);
    for (const projection of [av, bv, wv]) assert.ok(!('deck' in projection) && !('hands' in projection));
    watch.send({ version: 1, action: 'draw', id, revision: 0 });
    await watch.wait(frame => frame.t === 'match-error' && frame.reason === 'unavailable', 'spectator cannot draw');
    const playable = av.hand.find(card => card.playable);
    a.send({ version: 1, action: playable ? 'play' : 'draw', id, revision: 0,
        ...(playable ? { card: playable.id, suit: 'D' } : {}) });
    await watch.wait(frame => frame.state?.match?.revision === 1, 'spectator sees public move');
    const after = await b.wait(frame => frame.state?.match?.revision === 1, 'opponent sees public move');
    b.socket.close(1000, 'Eights fixture reconnect');
    const returning = await connect(black);
    returning.send({ version: 1, action: 'sync' });
    const restored = await returning.wait(frame => frame.state?.match?.revision === 1, 'restored private hand');
    assert.deepEqual(restored.state.match.hand, after.state.match.hand);
    returning.send({ version: 1, action: 'resign', id, revision: 1 });
    await a.wait(frame => frame.state?.match?.result?.winner === 'a', 'Eights resignation');
    a.send({ version: 1, action: 'rematch', id });
    await returning.wait(frame => frame.state?.rematch === 'a', 'Eights rematch invitation');
    returning.send({ version: 1, action: 'rematch', id });
    const rematch = await a.wait(frame => frame.state?.id && frame.state.id !== id, 'fresh Eights rematch');
    assert.equal(rematch.state.seat, 'b');
    assert.equal(rematch.state.match.hand.length, 7);
    assert.ok(chess.frames.every(frame => frame.state?.game !== 'crapeights'));
    assert.ok(watch.frames.every(frame => !frame.state?.match?.hand?.length));
    return { a, spectator };
}

async function verifyRummy(white, black, spectator, ref) {
    const ticketPath = '/beta/arcade-turdrummy-ticket', matchPath = '/beta/arcade-turdrummy-match';
    async function connect(guest) {
        const response = await upgrade(guest.cookie, await grant(guest, ref, ticketPath), matchPath);
        assert.equal(response.status, 101);
        const link = observe(response.webSocket);
        await link.wait(frame => frame.t === 'match-ready', 'Rummy ready');
        return link;
    }
    const a = await connect(white), b = await connect(black), watch = await connect(spectator);
    const revision = (link, value) => link.wait(frame => frame.state?.match?.revision === value, 'Rummy revision ' + value);
    a.send({ version: 1, action: 'open' });
    const id = (await b.wait(frame => frame.state?.waiting, 'Rummy open')).state.id;
    const send = (link, action, value, fields = {}) => link.send({ version: 1, action, id, revision: value, ...fields });
    send(b, 'join');
    const [host, player, spectatorView] = (await Promise.all([a, b, watch].map(link => revision(link, 0)))).map(frame => frame.state.match);
    assert.equal(host.hand.length, 10);
    assert.equal(player.hand.length, 10);
    assert.equal(host.hand.some(card => player.hand.some(other => card.id === other.id)), false);
    assert.deepEqual(spectatorView.hand, []);
    assert.deepEqual(spectatorView.top, player.top);
    send(watch, 'draw-stock', 0);
    await watch.wait(frame => frame.t === 'match-error' && frame.reason === 'unavailable', 'spectator cannot draw Rummy');
    send(b, 'draw-stock', 0);
    const [publicStockDraw, privateStockDraw, spectatorStockDraw] = (await Promise.all([a, b, watch].map(link => revision(link, 1)))).map(frame => frame.state.match);
    assert.equal(privateStockDraw.hand.length, 11);
    assert.equal(typeof privateStockDraw.drawn, 'number');
    for (const view of [publicStockDraw, spectatorStockDraw]) {
        assert.equal(view.drawn, null);
        assert.equal(view.stockCount, 30);
        assert.ok(!('stock' in view) && !('hands' in view));
    }
    b.socket.close(1000, 'Rummy fixture reconnect');
    const back = await connect(black);
    back.send({ version: 1, action: 'sync' });
    assert.deepEqual((await revision(back, 1)).state.match, privateStockDraw);
    send(back, 'discard', 1, { card: privateStockDraw.drawn });
    await revision(a, 2);
    send(a, 'draw-discard', 2);
    const picked = (await revision(a, 3)).state.match;
    assert.equal(picked.blocked, privateStockDraw.drawn);
    send(a, 'discard', 3, { card: picked.blocked });
    await a.wait(frame => frame.t === 'match-error' && frame.reason === 'return-discard', 'Rummy discard restriction');
    send(a, 'discard', 3, { card: picked.hand.find(card => card.id !== picked.blocked).id });
    await revision(back, 4);
    send(back, 'resign', 4);
    await a.wait(frame => frame.state?.match?.result?.winner === 'a', 'Rummy resignation');
    send(a, 'rematch');
    await back.wait(frame => frame.state?.rematch === 'a', 'Rummy rematch offer');
    send(back, 'rematch');
    const rematch = await a.wait(frame => frame.state?.id && frame.state.id !== id, 'fresh Rummy rematch');
    assert.equal(rematch.state.seat, 'b');
    assert.equal(rematch.state.match.hand.length, 10);
    assert.ok(watch.frames.every(frame => !frame.state?.match?.hand?.length));
    return a;
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
        bindings: { FIXTURE_NONCE: nonce, HANGOUT_SESSION_AUTHORITY: 'lobby-v1', HANGOUT_BETA_MODE: 'protected', HANGOUT_ARCADE_CHESS: '1', HANGOUT_ARCADE_CRAPEIGHTS: '1', HANGOUT_ARCADE_TURDRUMMY: '1',
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
    const { a: cards, spectator } = await verifyEights(white, black, ch.keepRef, a);
    const rummy = await verifyRummy(white, black, spectator, ch.keepRef);
    assert.ok([...a.frames, ...cards.frames].every(frame => frame.state?.game !== 'turdrummy'));
    white.lobby.send({ t: 'say', ch: room, text: 'Good luck at Chess' });
    await black.lobby.wait(frame => frame.t === 'line' && frame.text === 'Good luck at Chess', 'chat while match is open');
    const partAt = a.frames.length, cardsPartAt = cards.frames.length, rummyPartAt = rummy.frames.length;
    black.lobby.send({ t: 'cmd', name: 'part', args: [room], ch: room });
    await black.lobby.wait(frame => frame.t === 'part' && frame.ch === room, 'explicit room departure');
    await a.wait(frame => frame.t === 'match-state' && frame.state === null, 'seat retirement', partAt);
    await cards.wait(frame => frame.t === 'match-state' && frame.state === null, 'Eights seat retirement', cardsPartAt);
    await rummy.wait(frame => frame.t === 'match-state' && frame.state === null, 'Rummy seat retirement', rummyPartAt);
    console.log('Passed native TurdRummy private stock draws, spectator projection, mid-turn reconnect, restricted discard, rematch, and retirement.');
    console.log('Passed native Crappy Eights private hands, spectator projection, wrong-game grant rejection, rejoin, and rematch.');
    console.log('Passed native private invitations, session-bound one-use grants, two-brand Chess move and chat, match reconnection, and explicit seat retirement.');
    }
} finally {
    await mf?.dispose();
    await runtime?.close();
    await rm(directory, { recursive: true, force: true });
}
