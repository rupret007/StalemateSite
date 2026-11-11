import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import { findDuelSolution } from '../../hangout-worker/arcade/games/turdomania-duel.js';
import { unpackRushRacer } from '../../hangout-worker/arcade/games/turdrush-race.js';
import { Miniflare, convertV4MiniflareOptions } from './durable-records/node_modules/miniflare/dist/src/index.js';

const origin = 'https://local-fixture.invalid';
const invite = 'local-arcade-fixture-invitation-2026';
const preview = 'local-arcade-fixture-preview-key-2026';
const nonce = randomBytes(16).toString('hex');
const room = '#game-2ca9e1x1be34a';
const browserName = process.argv.find(arg => arg.startsWith('--browser='))?.slice(10) || '';
const browserMedia = process.argv.includes('--media');
const relay = process.argv.includes('--relay');
const fixtureIce = { urls: [process.env.ARCADE_TEST_TURN_URL || 'turn:fixture.invalid:3478'],
    username: 'arcade-fixture', credential: 'arcade-local-turn-only' };
assert.ok(!browserMedia || browserName === 'chromium', 'the synthetic device media test uses Chromium');
assert.ok(['', 'chromium', 'webkit'].includes(browserName), 'choose --browser=chromium or --browser=webkit');
assert.ok(!relay || !browserName || browserMedia && process.env.ARCADE_TEST_TURN_URL, 'browser relay test needs --media and a local TURN URL');
const evidence = process.env.ARCADE_BROWSER_EVIDENCE ? resolve(process.env.ARCADE_BROWSER_EVIDENCE) : null;
const app = fileURLToPath(new URL('../../', import.meta.url));
const assets = fileURLToPath(new URL('../../.beta-assets/', import.meta.url));
const sharedSource = process.env.ARCADE_TEST_SOURCE ? resolve(process.env.ARCADE_TEST_SOURCE) : null;
const radDad = process.env.ARCADE_TEST_RAD_DAD ? resolve(process.env.ARCADE_TEST_RAD_DAD) : null;
assert.equal(!!sharedSource, !!radDad, 'provide both arcade checkouts for the cross-site browser proof');
const directory = await mkdtemp(join(tmpdir(), 'game-night-arcade-'));
let mf, runtime;
let heldMint;

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
const reportQueueControl = payload => mf.dispatchFetch(origin + '/_fixture/game-night-reports', {
    headers: { 'X-Fixture-Nonce': nonce, 'Content-Type': 'application/json' }, method: 'POST', body: JSON.stringify(payload)
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

async function verifySpades(white, black, spectator, ref) {
    const north = await guest('FixtureNorth', 'stalemate', '192.0.2.14');
    const east = await guest('FixtureEast', 'rad-dad', '192.0.2.15');
    for (const [player, nick] of [[north, 'FixtureNorth'], [east, 'FixtureEast']]) {
        await pause();
        white.lobby.send({ t: 'cmd', name: 'invite', args: [nick, room], ch: room,
            roomInstance: ref, personContext: 1, personPeer: player.id });
        await player.lobby.wait(frame => frame.t === 'invite' && frame.ch === room, 'Spades room invitation');
        player.lobby.send({ t: 'cmd', name: 'join', args: [room], ch: '#stalemate' });
        await player.lobby.wait(frame => frame.t === 'join' && frame.ch.name === room, 'Spades room admission');
    }
    const players = { south: white, west: black, north, east };
    async function connect(player) {
        const response = await upgrade(player.cookie, await grant(player, ref, '/beta/arcade-turdspades-ticket'), '/beta/arcade-turdspades-match');
        assert.equal(response.status, 101);
        const link = observe(response.webSocket);
        await link.wait(frame => frame.t === 'match-ready', 'Spades ready');
        return link;
    }
    const links = {};
    for (const [seat, player] of Object.entries(players)) links[seat] = await connect(player);
    const watch = await connect(spectator), host = links.south;
    host.send({ version: 1, action: 'open' });
    const id = (await watch.wait(frame => frame.state?.waiting, 'Spades table open')).state.id;
    const send = (link, action, fields = {}) => link.send({ version: 1, id, action, ...fields });
    const seatsAt = (count, start = 0) => watch.wait(frame => frame.state?.occupied?.length === count, 'Spades seated ' + count, start);
    send(links.west, 'join', { seat: 'west' });
    await seatsAt(2);
    send(links.north, 'join', { seat: 'west' });
    await links.north.wait(frame => frame.t === 'match-error' && frame.reason === 'seat-unavailable', 'occupied seat refused');
    send(links.north, 'join', { seat: 'north' });
    await seatsAt(3);
    const releasedAt = watch.frames.length;
    send(links.north, 'leave');
    await seatsAt(2, releasedAt);
    send(links.north, 'join', { seat: 'north' });
    send(links.east, 'join', { seat: 'east' });
    const revision = (link, value) => link.wait(frame => frame.state?.match?.revision === value, 'Spades revision ' + value);
    let publicView = (await revision(watch, 0)).state.match;
    const initial = await Promise.all(Object.entries(links).map(async ([seat, link]) => {
        const view = (await revision(link, 0)).state;
        assert.equal(view.seat, seat);
        assert.equal(view.match.hand.length, 13);
        return view.match.hand;
    }));
    assert.equal(new Set(initial.flat().map(card => card.id)).size, 52);
    assert.deepEqual(publicView.hand, []);
    send(watch, 'bid', { revision: 0, bid: 1 });
    await watch.wait(frame => frame.t === 'match-error' && frame.reason === 'unavailable', 'Spades spectator cannot bid');
    for (const bid of [0, 3, 2, 4]) {
        send(links[publicView.turn], 'bid', { revision: publicView.revision, bid });
        publicView = (await revision(watch, publicView.revision + 1)).state.match;
    }
    const westBefore = (await revision(links.west, 4)).state.match;
    links.west.socket.close(1000, 'Spades fixture reconnect');
    links.west = await connect(black);
    send(links.west, 'sync');
    assert.deepEqual((await revision(links.west, 4)).state.match, westBefore);
    while (publicView.phase === 'play') {
        const actor = links[publicView.turn];
        const visible = (await revision(actor, publicView.revision)).state.match;
        const card = visible.hand.find(value => value.playable);
        assert.ok(card, 'legal card available');
        send(actor, 'play', { revision: publicView.revision, card: card.id });
        publicView = (await revision(watch, publicView.revision + 1)).state.match;
    }
    assert.equal(publicView.phase, 'round-end');
    assert.equal(Object.values(publicView.tricks).reduce((sum, value) => sum + value, 0), 13);
    assert.equal(publicView.lastTrick.length, 4);
    assert.equal(publicView.roundResult.length, 2);
    assert.ok(watch.frames.every(frame => !frame.state?.match?.hand?.length));
    if (!publicView.result) {
        send(host, 'next-round', { revision: publicView.revision });
        publicView = (await revision(watch, publicView.revision + 1)).state.match;
        assert.equal(publicView.round, 2);
        send(host, 'resign', { revision: publicView.revision });
        await revision(watch, publicView.revision + 1);
    }
    const watchAt = watch.frames.length;
    for (const link of Object.values(links)) send(link, 'rematch');
    const fresh = await watch.wait(frame => frame.state?.id && frame.state.id !== id, 'four-seat rematch', watchAt);
    assert.equal(fresh.state.match.round, 1);
    for (const [seat, link] of Object.entries(links)) {
        const view = await link.wait(frame => frame.state?.id === fresh.state.id, 'same Spades partnership');
        assert.equal(view.state.seat, seat);
    }
    return { host, north, east };
}

async function verifyJack(white, black, north, east, spectator, ref) {
    async function connect(player) {
        const endpoint = '/beta/arcade-turdjack';
        const ticket = await grant(player, ref, endpoint + '-ticket');
        const response = await upgrade(player.cookie, ticket, endpoint + '-match');
        assert.equal(response.status, 101);
        const link = observe(response.webSocket);
        await link.wait(frame => frame.t === 'match-ready', 'Crapjack ready');
        return link;
    }
    const players = { one: white, two: black, three: north, four: east };
    const links = {};
    for (const [seat, player] of Object.entries(players)) links[seat] = await connect(player);
    const watch = await connect(spectator), host = links.one;
    host.send({ version: 1, action: 'open' });
    const id = (await watch.wait(frame => frame.state?.waiting, 'Crapjack table open')).state.id;
    const send = (link, action, fields = {}) => link.send({ version: 1, id, action, ...fields });
    send(host, 'start');
    await host.wait(frame => frame.reason === 'start-unavailable', 'Crapjack minimum seats enforced');
    for (const [index, seat] of ['two', 'three', 'four'].entries()) {
        send(links[seat], 'join', { seat });
        await watch.wait(frame => frame.state?.occupied.length === index + 2, 'Crapjack seats');
    }
    send(links.two, 'start');
    await links.two.wait(frame => frame.reason === 'start-unavailable', 'only the host can start');
    send(host, 'start');
    const revision = (link, value) => link.wait(frame => frame.state?.match?.revision === value, 'Crapjack revision ' + value);
    let publicView = (await revision(watch, 0)).state.match;
    assert.deepEqual(publicView.players, Object.keys(players));
    send(watch, 'wager', { revision: 0, chips: 10 });
    await watch.wait(frame => frame.reason === 'unavailable', 'Crapjack spectator cannot wager');
    const stakes = [10, 20, 50, 100];
    for (const [index, link] of Object.values(links).entries()) {
        send(link, 'wager', { revision: index, chips: stakes[index] });
        publicView = (await revision(watch, index + 1)).state.match;
    }
    for (const [seat, link] of Object.entries(links)) {
        const { state } = await revision(link, 4);
        assert.equal(state.seat, seat);
        assert.equal(state.match.self.hands[0].cards.length, 2);
        assert.equal(state.match.self.wager, stakes[Object.keys(links).indexOf(seat)]);
        assert.deepEqual(state.match.table, publicView.table);
        assert.ok(Object.values(state.match.table).every(player => Object.keys(player).sort().join() === 'hands,ready,wager'));
    }
    assert.equal(publicView.dealerHidden, publicView.phase !== 'settled');
    assert.ok(publicView.dealerHidden ? publicView.dealer.length === 1 : publicView.dealer.length >= 2);
    const original = (await revision(links.two, 4)).state.match;
    links.two.socket.close(1000, 'Crapjack fixture reconnect');
    links.two = await connect(black);
    send(links.two, 'sync');
    assert.deepEqual((await revision(links.two, 4)).state.match, original);
    if (publicView.phase === 'insurance') {
        for (const link of Object.values(links)) {
            send(link, 'skip-cover', { revision: publicView.revision });
            publicView = (await revision(watch, publicView.revision + 1)).state.match;
        }
    }
    while (publicView.phase === 'play') {
        send(links[publicView.active], 'stand', { revision: publicView.revision });
        publicView = (await revision(watch, publicView.revision + 1)).state.match;
    }
    assert.equal(publicView.phase, 'settled');
    assert.equal(publicView.dealerHidden, false);
    assert.ok(publicView.dealer.length >= 2);
    assert.ok(Object.values(publicView.table).every(player => player.hands[0].outcome));
    assert.ok(watch.frames.filter(frame => frame.state?.match).every(({ state: { match } }) =>
        match.self === null && match.actions.length === 0 && !('shoe' in match)));
    send(host, 'next-round', { revision: publicView.revision });
    publicView = (await revision(watch, publicView.revision + 1)).state.match;
    assert.equal(publicView.round, 2);
    assert.equal(publicView.phase, 'wager');
    send(host, 'finish', { revision: publicView.revision });
    await revision(watch, publicView.revision + 1);
    for (const [index, link] of Object.values(links).entries()) {
        const offset = watch.frames.length;
        send(link, 'rematch');
        if (index < 3) {
            await watch.wait(frame => frame.state?.rematchVotes.length === index + 1, 'Crapjack fresh session vote', offset);
        } else {
            const fresh = await watch.wait(frame => frame.state?.id && frame.state.id !== id, 'Crapjack fresh session', offset);
            assert.equal(fresh.state.match.round, 1);
            assert.deepEqual(fresh.state.occupied, Object.keys(players));
            const own = await links.two.wait(frame => frame.state?.id === fresh.state.id, 'Crapjack new private bankroll');
            assert.equal(own.state.match.self.chips, 1000);
        }
    }
    return host;
}

async function verifyTurdtris(white, black, spectator, ref) {
    const endpoint = '/beta/arcade-turdtris';
    const connect = async player => {
        const ticket = await grant(player, ref, endpoint + '-ticket');
        const response = await upgrade(player.cookie, ticket, endpoint + '-match');
        assert.equal(response.status, 101);
        const link = observe(response.webSocket);
        await link.wait(frame => frame.t === 'match-ready', 'Turdtris connection');
        return link;
    };
    const host = await connect(white), watch = await connect(spectator);
    let guest = await connect(black);
    host.send({ version: 1, action: 'open' });
    const id = (await guest.wait(frame => frame.state?.waiting, 'Turdtris open race')).state.id;
    const send = (link, action, fields = {}) => link.send({ version: 1, id, action, ...fields });
    send(guest, 'join');
    const a = (await host.wait(frame => frame.state?.match, 'Turdtris host countdown')).state.match;
    const b = (await guest.wait(frame => frame.state?.match, 'Turdtris guest countdown')).state.match;
    assert.equal(a.seed, b.seed);
    assert.equal(a.startsAt, b.startsAt);
    assert.deepEqual(a.self.board, b.self.board);
    assert.deepEqual(a.self.next, b.self.next);
    send(host, 'input', { sequence: 1, inputs: ['drop'] });
    await host.wait(frame => frame.reason === 'countdown', 'prestart drop refused');
    await new Promise(resolve => setTimeout(resolve, Math.max(0, a.startsAt - Date.now()) + 25));
    send(watch, 'input', { sequence: 1, inputs: ['drop'] });
    await watch.wait(frame => frame.reason === 'unavailable', 'Turdtris spectator cannot control a board');
    const confirmed = (link, sequence) => link.wait(frame => frame.state?.match?.self?.sequence === sequence, 'confirmed sprint input ' + sequence);
    const timings = [];
    for (let sequence = 1; sequence <= 13; sequence++) {
        const started = performance.now();
        send(host, 'input', { sequence, inputs: sequence === 1 ? ['left', 'drop'] : [sequence % 2 ? 'left' : 'right'] });
        send(guest, 'input', { sequence, inputs: sequence === 1 ? ['right', 'drop'] : [sequence % 2 ? 'right' : 'left'] });
        const frames = await Promise.all([confirmed(host, sequence), confirmed(guest, sequence)]);
        timings.push(performance.now() - started);
        assert.ok(frames.every(frame => frame.state.match.id === id));
        await new Promise(resolve => setTimeout(resolve, 90));
    }
    const publicView = (await watch.wait(frame => frame.state?.match?.revision === 26, 'Turdtris spectator sees both boards')).state.match;
    assert.equal(publicView.self, null);
    assert.notDeepEqual(publicView.boards.a.grid, publicView.boards.b.grid);
    assert.ok(publicView.boards.a.score > 0 && publicView.boards.b.score > 0);
    guest.socket.close(1000, 'Turdtris reconnect fixture');
    guest = await connect(black);
    send(guest, 'sync');
    const recovered = (await confirmed(guest, 13)).state.match;
    assert.deepEqual(recovered.boards.b.grid, publicView.boards.b.grid);
    assert.equal(recovered.startsAt, a.startsAt);
    send(guest, 'resign');
    const result = await host.wait(frame => frame.state?.match?.result?.winner === 'a', 'Turdtris forfeit');
    assert.equal(result.state.match.result.reason, 'resign');
    send(host, 'rematch');
    await guest.wait(frame => frame.state?.rematch === 'a', 'Turdtris rematch vote');
    send(guest, 'rematch');
    const fresh = await guest.wait(frame => frame.state?.match?.id && frame.state.match.id !== id, 'Turdtris rematch');
    assert.equal(fresh.state.seat, 'a');
    assert.equal(fresh.state.match.self.sequence, 0);
    timings.sort((a, b) => a - b);
    console.log(`Turdtris local workerd paired input confirmation, ${timings.length} samples: median ${timings[6].toFixed(1)} ms, max ${timings.at(-1).toFixed(1)} ms.`);
    return host;
}

async function verifyTurdomania(white, black, spectator, ref) {
    const endpoint = '/beta/arcade-turdomania';
    const connect = async player => {
        const ticket = await grant(player, ref, endpoint + '-ticket');
        const response = await upgrade(player.cookie, ticket, endpoint + '-match');
        assert.equal(response.status, 101);
        const link = observe(response.webSocket);
        await link.wait(frame => frame.t === 'match-ready', 'Turdomania connection');
        return link;
    };
    const host = await connect(white), watch = await connect(spectator);
    let guest = await connect(black);
    host.send({ version: 1, action: 'open' });
    const id = (await guest.wait(frame => frame.state?.waiting, 'Turdomania open duel')).state.id;
    const send = (link, action, fields = {}) => link.send({ version: 1, id, action, ...fields });
    send(guest, 'join');
    const a = (await host.wait(frame => frame.state?.match, 'Turdomania host countdown')).state.match;
    const b = (await guest.wait(frame => frame.state?.match, 'Turdomania guest countdown')).state.match;
    const path = findDuelSolution(a.self.board);
    assert.ok(path.length >= 5);
    assert.equal(a.startsAt, b.startsAt);
    assert.deepEqual(a.self.board, b.self.board);
    assert.equal(a.boards, null);
    assert.equal(b.boards, null);
    send(host, 'pop', { move: 0, tile: path[0] });
    await host.wait(frame => frame.reason === 'countdown', 'Turdomania rejects prestart pop');
    await new Promise(resolve => setTimeout(resolve, Math.max(0, a.startsAt - Date.now()) + 25));
    send(watch, 'pop', { move: 0, tile: path[0] });
    await watch.wait(frame => frame.reason === 'unavailable', 'Turdomania spectator cannot pop');
    const view = (link, seat, moves) => link.wait(frame => frame.state?.match?.players[seat].moves === moves, 'confirmed puzzle move ' + seat + moves);
    send(host, 'pop', { move: 0, tile: path[0] });
    const first = (await view(host, 'a', 1)).state.match;
    const watcher = (await view(watch, 'a', 1)).state.match;
    assert.equal(watcher.self, null);
    assert.deepEqual(watcher.boards.a, first.self.board);
    assert.deepEqual(watcher.boards.b, b.self.board);
    assert.deepEqual((await view(guest, 'a', 1)).state.match.self.board, b.self.board);
    send(guest, 'pop', { move: 0, tile: path[0] });
    const prior = (await view(guest, 'b', 1)).state.match;
    guest.socket.close(1000, 'Turdomania reconnect fixture');
    guest = await connect(black);
    send(guest, 'sync');
    const recovered = (await view(guest, 'b', 1)).state.match;
    assert.equal(recovered.startsAt, a.startsAt);
    assert.deepEqual(recovered.self, prior.self);
    for (const [move, tile] of path.entries()) {
        if (!move) continue;
        send(host, 'pop', { move, tile });
        send(guest, 'pop', { move, tile });
        await Promise.all([view(host, 'a', move + 1), view(guest, 'b', move + 1)]);
    }
    const result = (await watch.wait(frame => frame.state?.match?.phase === 'finished', 'Turdomania completed duel')).state.match;
    assert.deepEqual(result.boards, { a: [], b: [] });
    assert.equal(result.players.a.score, result.players.b.score);
    assert.equal(result.result.winner, null);
    assert.equal(result.result.reason, 'boards');
    send(host, 'rematch');
    await guest.wait(frame => frame.state?.rematch === 'a', 'Turdomania rematch vote');
    send(guest, 'rematch');
    const fresh = await guest.wait(frame => frame.state?.match?.id && frame.state.match.id !== id, 'Turdomania rematch');
    assert.equal(fresh.state.seat, 'a');
    assert.equal(fresh.state.match.players.a.left, 36);
    console.log(`Passed native Turdomania complete shared puzzle (${path.length} legal moves per player), independent boards, spectator permissions, reconnect, draw and rematch.`);
    return host;
}

async function verifyTurdRush(white, black, spectator, ref) {
    const endpoint = '/beta/arcade-turdrush';
    const connect = async player => {
        const ticket = await grant(player, ref, endpoint + '-ticket');
        const response = await upgrade(player.cookie, ticket, endpoint + '-match');
        assert.equal(response.status, 101);
        const link = observe(response.webSocket);
        await link.wait(frame => frame.t === 'match-ready', 'Turd Rush connection');
        return link;
    };
    const host = await connect(white), watch = await connect(spectator);
    let guest = await connect(black);
    host.send({ version: 1, action: 'open' });
    const id = (await guest.wait(frame => frame.state?.waiting, 'Turd Rush open race')).state.id;
    const send = (link, action, fields = {}) => link.send({ version: 1, id, action, ...fields });
    send(guest, 'join');
    const a = (await host.wait(frame => frame.state?.match, 'Turd Rush host countdown')).state.match;
    const b = (await guest.wait(frame => frame.state?.match, 'Turd Rush guest countdown')).state.match;
    assert.equal(a.startsAt, b.startsAt);
    assert.equal(a.seed, b.seed);
    assert.deepEqual(a.runner.run.entities, b.runner.run.entities);
    const hazards = unpackRushRacer(a.runner).run.entities.filter(entity => entity.at === 100 && ['crate', 'beam', 'barrier'].includes(entity.kind));
    const lane = hazards.find(entity => entity.lane !== 1).lane;
    const inputs = [[1, lane === 0 ? 'swipe-left' : 'swipe-right']];
    send(host, 'input', { sequence: 1, inputs });
    await host.wait(frame => frame.reason === 'countdown', 'Turd Rush prestart input refusal');
    await new Promise(resolve => setTimeout(resolve, Math.max(0, a.startsAt - Date.now()) + 20));
    send(watch, 'input', { sequence: 1, inputs });
    send(host, 'input', { sequence: 1, inputs });
    send(guest, 'input', { sequence: 1, inputs });
    await watch.wait(frame => frame.reason === 'unavailable', 'Turd Rush spectator cannot steer');
    await host.wait(frame => frame.state?.match?.runner.sequence === 1, 'Turd Rush host accepted input');
    await guest.wait(frame => frame.state?.match?.runner.sequence === 1, 'Turd Rush guest accepted input');
    guest.socket.close(1000, 'Turd Rush reconnect fixture');
    guest = await connect(black);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, a.startsAt + 650 - Date.now())));
    send(guest, 'sync');
    const recovered = (await guest.wait(frame => frame.state?.match?.runner.run.player.lane === lane, 'Turd Rush recovered lane')).state.match;
    assert.equal(recovered.runner.sequence, 1);
    assert.equal(recovered.startsAt, a.startsAt);
    assert.ok(recovered.runner.run.distance > 0);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, a.startsAt + 8700 - Date.now())));
    send(watch, 'sync');
    const result = (await host.wait(frame => frame.state?.match?.phase === 'finished', 'Turd Rush confirmed collision')).state.match;
    assert.equal(result.result.winner, null);
    assert.deepEqual(result.players.a, result.players.b);
    assert.equal(result.players.a.status, 'crashed');
    assert.ok(result.players.a.distance >= 99 && result.players.a.distance <= 100);
    const publicMatch = (await watch.wait(frame => frame.state?.match?.phase === 'finished', 'Turd Rush spectator result')).state.match;
    assert.deepEqual(publicMatch.result, result.result);
    send(host, 'rematch');
    await guest.wait(frame => frame.state?.rematch === 'a', 'Turd Rush rematch vote');
    send(guest, 'rematch');
    const fresh = await guest.wait(frame => frame.state?.match?.id && frame.state.match.id !== id, 'Turd Rush rematch');
    assert.equal(fresh.state.seat, 'a');
    assert.equal(fresh.state.match.runner.sequence, 0);
    console.log(`Passed native Turd Rush same course, both verified collisions, equal result, spectator refusal, reconnect and rematch. Player snapshot ${Buffer.byteLength(JSON.stringify(recovered))} bytes.`);
    return host;
}

async function verifyTurdanoid(white, black, spectator, ref) {
    const endpoint = '/beta/arcade-turdanoid';
    const connect = async player => {
        const ticket = await grant(player, ref, endpoint + '-ticket');
        const response = await upgrade(player.cookie, ticket, endpoint + '-match');
        assert.equal(response.status, 101);
        const link = observe(response.webSocket);
        await link.wait(frame => frame.t === 'match-ready', 'Turdanoid connection');
        return link;
    };
    const host = await connect(white), watch = await connect(spectator);
    let guest = await connect(black);
    host.send({ version: 1, action: 'open' });
    const id = (await guest.wait(frame => frame.state?.waiting, 'Turdanoid open race')).state.id;
    const send = (link, action, fields = {}) => link.send({ version: 1, id, action, ...fields });
    send(guest, 'join');
    const a = (await host.wait(frame => frame.state?.match, 'Turdanoid host countdown')).state.match;
    const b = (await guest.wait(frame => frame.state?.match, 'Turdanoid guest countdown')).state.match;
    assert.equal(a.startsAt, b.startsAt);
    assert.equal(a.seed, b.seed);
    assert.deepEqual(a.wall, b.wall);
    assert.deepEqual(a.runner.run.hp, b.runner.run.hp);
    const serve = { sequence: 1, inputs: [[1, 'serve']] };
    send(host, 'input', serve);
    await host.wait(frame => frame.reason === 'countdown', 'Turdanoid prestart input refusal');
    await new Promise(resolve => setTimeout(resolve, Math.max(0, a.startsAt + 20 - Date.now())));
    send(watch, 'input', serve);
    send(host, 'input', serve);
    send(guest, 'input', serve);
    await watch.wait(frame => frame.reason === 'unavailable', 'Turdanoid spectator cannot launch');
    for (const player of [host, guest]) {
        await player.wait(frame => frame.state?.match?.runner.sequence === 1, 'Turdanoid launch accepted');
    }
    guest.socket.close(1000, 'Turdanoid reconnect fixture');
    guest = await connect(black);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, a.startsAt + 1800 - Date.now())));
    send(guest, 'sync');
    const scored = frame => frame.state?.match?.players.a.score > 0 && frame.state.match.players.b.score > 0;
    const recovered = (await guest.wait(scored, 'Turdanoid resumed scored board')).state.match;
    assert.equal(recovered.runner.sequence, 1);
    assert.equal(recovered.runner.run.serves, 1);
    assert.equal(recovered.startsAt, a.startsAt);
    assert.notDeepEqual(recovered.runner.run.hp, b.runner.run.hp);
    assert.deepEqual(recovered.players.a, recovered.players.b);
    assert.deepEqual((await watch.wait(scored, 'Turdanoid spectator scoreboard')).state.match.players, recovered.players);
    send(guest, 'resign');
    const result = (await host.wait(frame => frame.state?.match?.result, 'Turdanoid forfeit')).state.match.result;
    assert.equal(result.winner, 'a');
    assert.equal(result.reason, 'resign');
    send(host, 'rematch');
    await guest.wait(frame => frame.state?.rematch === 'a', 'Turdanoid rematch vote');
    send(guest, 'rematch');
    const fresh = (await guest.wait(frame => frame.state?.match?.id && frame.state.match.id !== id, 'Turdanoid rematch')).state;
    assert.equal(fresh.seat, 'a');
    assert.equal(fresh.match.runner.sequence, 0);
    assert.equal(fresh.match.players.a.score + fresh.match.players.b.score, 0);
    console.log(`Passed native Turdanoid same wall, verified brick hits on both seats, spectator refusal, reconnect, forfeit and rematch. Player snapshot ${Buffer.byteLength(JSON.stringify(recovered))} bytes.`);
    return host;
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
        assert.equal(initial.reports, true);
        return media;
    };
    const wrongChannel = await upgrade(white.cookie, await grant(white, ref), endpoint);
    assert.equal(wrongChannel.status, 403);
    await wrongChannel.body?.cancel();
    const a = await join(white), b = await join(black);
    await a.wait(frame => frame.peers?.some(peer => peer.id === black.id), 'other call participant');
    async function report(link, { request, target, reason, consent = true }) {
        const start = link.frames.length;
        link.send({ version: 1, action: 'report', request, target, reason, consent });
        return (await link.wait(frame => frame.t === 'media-report' && frame.request === request, 'call report response', start)).status;
    }
    const first = { request: 'a'.repeat(24), target: black.id, reason: 'Fixture live call concern' };
    assert.equal(await report(a, { ...first, consent: false }), 'invalid');
    assert.equal(await report(a, { ...first, target: white.id }), 'peer-unavailable');
    assert.equal(await report(a, { ...first, target: 'c' + '0'.repeat(32) }), 'peer-unavailable');
    assert.equal(await report(a, { ...first, reason: 'webjam://fixture-do-not-share' }), 'invalid');
    const armed = await reportQueueControl({ fail: true });
    assert.equal(armed.status, 200);
    assert.deepEqual(await armed.json(), { armed: true });
    assert.equal(await report(a, first), 'unavailable');
    const failed = await reportQueueControl({});
    assert.equal(failed.status, 200);
    assert.deepEqual(await failed.json(), { rollback: true, receipts: 0, reports: [] });
    assert.equal(await report(a, first), 'queued');
    assert.equal(await report(a, first), 'queued');
    assert.ok(b.frames.every(frame => frame.t !== 'media-report'));
    a.send({ version: 1, action: 'relay' });
    if (relay) {
        const allocation = await a.wait(frame => frame.t === 'media-relay', 'admitted relay credentials');
        assert.deepEqual(allocation.iceServers, [fixtureIce]);
        assert.ok(allocation.refreshInMs <= 540_000 && allocation.refreshInMs > 530_000);
        a.send({ version: 1, action: 'relay' });
        await a.wait(frame => frame.reason === 'relay-unavailable', 'early credential renewal refused');
        assert.ok(b.frames.every(frame => frame.t !== 'media-relay'));
    } else await a.wait(frame => frame.reason === 'relay-unavailable', 'relay switch off');
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
    if (relay) {
        let arrived, release;
        const pending = new Promise(resolve => { arrived = resolve; });
        const resume = new Promise(resolve => { release = resolve; });
        heldMint = async () => { arrived(); await resume; };
        b.send({ version: 1, action: 'relay' });
        let timeout;
        try {
            await Promise.race([pending, new Promise((_, reject) => {
                timeout = setTimeout(() => reject(Error('Relay fixture did not reach the provider')), 5000);
            })]);
            white.lobby.send({ t: 'say', ch: room, text: 'Chat works during a slow relay request' });
            await black.lobby.wait(frame => frame.t === 'line' && frame.text === 'Chat works during a slow relay request', 'chat during pending TURN request');
            const departing = b.frames.length;
            a.send({ version: 1, action: 'leave' });
            await b.wait(frame => frame.peers?.length === 0, 'call leave while relay issuance is pending', departing);
        } finally {
            clearTimeout(timeout);
            heldMint = null;
            release();
        }
        // A fresh command still gets a reply after the stale provider response.
        const afterLeave = b.frames.length;
        b.send({ version: 1, action: 'signal', to: white.id });
        await b.wait(frame => frame.reason === 'peer-unavailable', 'call still responds after peer departure', afterLeave);
        assert.ok(b.frames.every(frame => frame.t !== 'media-relay'));
        console.log('Passed native Game Night TURN budget admission, credential isolation and chat/leave during a pending provider request.');
    }
    const before = b.frames.length;
    if (!relay) {
        a.send({ version: 1, action: 'leave' });
        await b.wait(frame => frame.peers?.length === 0, 'call leave published', before);
    }
    const second = { request: 'b'.repeat(24), target: white.id, reason: 'Fixture report after the peer left' };
    assert.equal(await report(b, second), 'queued');
    const readback = await reportQueueControl({});
    assert.equal(readback.status, 200);
    const queue = await readback.json();
    assert.equal(queue.receipts, 2);
    assert.equal(queue.reports.length, 2);
    for (const [item, nick, input, membership] of [
        [queue.reports[0], 'FixtureBlack', first, 'live'],
        [queue.reports[1], 'FixtureWhite', second, 'unverified']
    ]) {
        assert.match(item.id, /^pr[A-Za-z0-9_-]{43}$/);
        assert.equal(item.kind, 'member');
        assert.equal(item.claimedName, nick);
        assert.equal(item.excerpt, '');
        assert.equal(item.reason, 'Game Night call · ' + input.reason);
        assert.equal(item.targetMembership, membership);
    }
    for (const other of [white.lobby, black.lobby, matchA, matchB]) {
        assert.ok(other.frames.every(frame => !['media-signal', 'media-relay', 'media-report'].includes(frame.t)));
        assert.ok(!JSON.stringify(other.frames).includes(first.reason));
        assert.ok(!JSON.stringify(other.frames).includes(second.reason));
    }
    b.send({ version: 1, action: 'leave' });
    console.log('Passed native call reports with consent, same-call witness, queue commit, deduplication, and late-peer privacy.');
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
        durableObjects: { LOBBY: { className: 'FixtureLobby', useSQLite: true }, QUOTA: { className: 'HangoutQuota', useSQLite: true }, ROOMS: { className: 'HangoutRoom', useSQLite: true },
            ...(relay ? { TURN_BUDGET: { className: 'HangoutTurnBudget', useSQLite: true } } : {}) },
        bindings: { FIXTURE_NONCE: nonce, FIXTURE_ARCADE_REPORTS: '1', HANGOUT_SESSION_AUTHORITY: 'lobby-v1', HANGOUT_BETA_MODE: 'protected', HANGOUT_ARCADE_CHESS: '1', HANGOUT_ARCADE_CRAPEIGHTS: '1', HANGOUT_ARCADE_TURDRUMMY: '1', HANGOUT_ARCADE_TURDSPADES: '1', HANGOUT_ARCADE_TURDJACK: '1', HANGOUT_ARCADE_TURDTRIS: '1', HANGOUT_ARCADE_TURDOMANIA: '1', HANGOUT_ARCADE_TURDRUSH: '1', HANGOUT_ARCADE_TURDANOID: '1',
            ...(browserName ? { FIXTURE_ARCADE_BROWSER: '1' } : {}),
            ...(!browserName || browserMedia ? { HANGOUT_ARCADE_MEDIA: '1' } : {}),
            ...(relay ? { HANGOUT_ARCADE_TURN: '1', HANGOUT_CF_ACCOUNT_ID: 'f'.repeat(32), HANGOUT_TURN_MONTHLY_GB: '1',
                HANGOUT_TURN_KEY_ID: 'arcade-fixture-key', HANGOUT_TURN_API_TOKEN: 'fixture', HANGOUT_TURN_ANALYTICS_TOKEN: 'fixture' } : {}),
            HANGOUT_HMAC_KEY: 'owned-arcade-fixture-hmac-not-for-deployment-2026', HANGOUT_BETA_INVITE_KEY: invite,
            HANGOUT_BETA_INVITE_VERSION: '1', HANGOUT_PREVIEW_KEY: preview, HANGOUT_OPEN: '1', HANGOUT_AI_ENABLED: '0', HANGOUT_TURN_ENABLED: '0' },
        ...(browserName ? { serviceBindings: { ASSETS: serveAsset } } : {}),
        outboundService: async request => {
            if (relay && request.url === 'https://api.cloudflare.com/client/v4/graphql') {
                return Response.json({ data: { viewer: { accounts: [{ callsTurnUsageAdaptiveGroups: [] }] } } });
            }
            if (relay && request.url === 'https://rtc.live.cloudflare.com/v1/turn/keys/arcade-fixture-key/credentials/generate-ice-servers') {
                assert.deepEqual(await request.json(), { ttl: 600 });
                await heldMint?.();
                return Response.json({ iceServers: [fixtureIce] });
            }
            return new Response('fixture egress denied', { status: 503 });
        }
    }));
    await mf.ready;
    const initialized = await mf.dispatchFetch(origin + '/_fixture/initialize', {
        method: 'POST', headers: { 'X-Fixture-Nonce': nonce, 'Content-Type': 'application/json' }, body: '{}'
    });
    assert.equal(initialized.status, 200, await initialized.text());
    if (browserName) {
        const { runArcadeBrowser } = await import('./arcade-browser.mjs');
        const browserOrigin = (await mf.ready).origin;
        await runArcadeBrowser(browserName, browserOrigin, invite, evidence, await previewEntrances(browserOrigin), browserMedia, relay);
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
    const { host: spades, north, east } = await verifySpades(white, black, spectator, ch.keepRef);
    const jack = await verifyJack(white, black, north, east, spectator, ch.keepRef);
    const tris = await verifyTurdtris(white, black, spectator, ch.keepRef);
    const mania = await verifyTurdomania(white, black, spectator, ch.keepRef);
    const rush = await verifyTurdRush(white, black, spectator, ch.keepRef);
    const brick = await verifyTurdanoid(white, black, spectator, ch.keepRef);
    assert.ok([...a.frames, ...cards.frames].every(frame => frame.state?.game !== 'turdrummy'));
    white.lobby.send({ t: 'say', ch: room, text: 'Good luck at Chess' });
    await black.lobby.wait(frame => frame.t === 'line' && frame.text === 'Good luck at Chess', 'chat while match is open');
    const partAt = a.frames.length, cardsPartAt = cards.frames.length, rummyPartAt = rummy.frames.length, spadesPartAt = spades.frames.length, jackPartAt = jack.frames.length, trisPartAt = tris.frames.length, maniaPartAt = mania.frames.length, rushPartAt = rush.frames.length;
    const brickPartAt = brick.frames.length;
    black.lobby.send({ t: 'cmd', name: 'part', args: [room], ch: room });
    await black.lobby.wait(frame => frame.t === 'part' && frame.ch === room, 'explicit room departure');
    await a.wait(frame => frame.t === 'match-state' && frame.state === null, 'seat retirement', partAt);
    await cards.wait(frame => frame.t === 'match-state' && frame.state === null, 'Eights seat retirement', cardsPartAt);
    await rummy.wait(frame => frame.t === 'match-state' && frame.state === null, 'Rummy seat retirement', rummyPartAt);
    await spades.wait(frame => frame.t === 'match-state' && frame.state === null, 'Spades seat retirement', spadesPartAt);
    await jack.wait(frame => frame.t === 'match-state' && frame.state === null, 'Crapjack seat retirement', jackPartAt);
    await tris.wait(frame => frame.t === 'match-state' && frame.state === null, 'Turdtris race retirement', trisPartAt);
    await mania.wait(frame => frame.t === 'match-state' && frame.state === null, 'Turdomania duel retirement', maniaPartAt);
    await rush.wait(frame => frame.t === 'match-state' && frame.state === null, 'Turd Rush race retirement', rushPartAt);
    await brick.wait(frame => frame.t === 'match-state' && frame.state === null, 'Turdanoid race retirement', brickPartAt);
    console.log('Passed native Turdtris countdown, same seed, separate boards, spectator permissions, paired inputs, reconnect, forfeit, rematch and retirement.');
    console.log('Passed native four-player Crapjack dealer settlement, hidden hands, spectator permissions, reconnect, fresh session and seat retirement.');
    console.log('Passed native four-seat TurdSpades, spectator privacy, bidding, 13 tricks, rematch and seat retirement.');
    console.log('Passed native TurdRummy private stock draws, spectator projection, mid-turn reconnect, restricted discard, rematch, and retirement.');
    console.log('Passed native Crappy Eights private hands, spectator projection, wrong-game grant rejection, rejoin, and rematch.');
    console.log('Passed native private invitations, session-bound one-use grants, two-brand Chess move and chat, match reconnection, and explicit seat retirement.');
    }
} finally {
    await mf?.dispose();
    await runtime?.close();
    await rm(directory, { recursive: true, force: true });
}
