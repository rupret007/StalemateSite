#!/usr/bin/env node
// Capture deterministic seated Game Night states for the family-alpha visual re-grade.
// Run with: node scripts/family-alpha-regrade-shots.mjs
// Optional: REGRADE_OUTPUT_DIR=/path/to/regrade-20261115, REGRADE_PORT=48xx (default 4825),
// REGRADE_STRICT=1 to fail on layout findings instead of recording them in manifest.json.
// The default output is the requested re-grade delivery folder under Documents.
// Shots are staged beside the output folder and swapped in only when every one
// succeeded, so a failed run leaves the previous delivery untouched.
// Uses the repository's installed @playwright/test (no install step) and Chromium.
// Only seated players are created and only the host's own screen is captured.

import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync, createReadStream, symlinkSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { arcadeHello, assertPort, brickWallShown, gameSpecs, layoutFindings, matchSocket, retireMatchSocket, seatStarted, settle } from './family-alpha-regrade-shots-lib.mjs';

const require = createRequire(import.meta.url);
const { chromium, expect } = require('@playwright/test');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.env.REGRADE_OUTPUT_DIR || path.join(homedir(), 'Documents', 'bob-overnight-inject', 'regrade-20261115'));
const port = Number(process.env.REGRADE_PORT || 4825);
const strict = process.env.REGRADE_STRICT === '1';
const viewports = [{ name: '390x844', width: 390, height: 844 }, { name: '1440x900', width: 1440, height: 900 }];
const versions = [
    // Compare the G3 private-demo baseline with the requested private-demo head.
    { version: 'current', sha: '59a77531e858b80a606858c8a0f94b3861e6136d', treeSha: 'b4468b55c1ecb397825917df4584127ef7724107',
        games: ['chess', 'partners-spades', 'four-player-spades', 'turdanoid'] },
    { version: 'new', sha: 'da871f3ac9fcc632df84da6629b2e130af881d6a', games: ['chess', 'partners-spades', 'four-player-spades', 'turdanoid'] }
];
const lobbyPath = '/r/45662413410ed051/lobby/';
const preview = 'local-preview-key-0001';
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json' };

function archive(sha, directory) {
    const bytes = execFileSync('git', ['archive', sha], { cwd: repo, maxBuffer: 512 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', directory], { input: bytes, maxBuffer: 512 * 1024 * 1024 });
    // Archived trees are served statically; worker imports still resolve through this checkout.
    const link = path.join(directory, 'node_modules');
    if (!existsSync(link)) symlinkSync(path.join(repo, 'node_modules'), link, 'dir');
}

function workerRoot(sourceRoot) {
    return existsSync(path.join(sourceRoot, 'hangout-worker/src/arcade-transport.mjs')) ? sourceRoot : repo;
}

async function staticServer(initialRoot) {
    let root = initialRoot;
    const server = createServer((request, response) => {
        let pathname;
        try { pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); }
        catch { response.writeHead(400).end(); return; }
        let file = path.resolve(root, `.${pathname}`);
        if (!file.startsWith(root + path.sep) && file !== root) { response.writeHead(403).end(); return; }
        if (pathname.endsWith('/')) file = path.join(file, 'index.html');
        if (!existsSync(file)) { response.writeHead(404).end(); return; }
        response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
        createReadStream(file).on('error', () => response.writeHead(500).end()).pipe(response);
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
    });
    return { origin: `http://127.0.0.1:${port}`, setRoot: value => { root = value; }, close: () => new Promise(resolve => server.close(resolve)) };
}

async function createFixture(browser, origin, sourceRoot, viewport) {
    const worker = workerRoot(sourceRoot);
    const { createLobby } = await import(pathToFileURL(path.join(worker, 'hangout-worker/src/lobby-core.mjs')));
    const { arcadeGame, arcadeRoomRequest, createArcadeTransport } = await import(pathToFileURL(path.join(worker, 'hangout-worker/src/arcade-transport.mjs')));
    const contexts = [], lobbySockets = new Map(), people = new Map(), matchSockets = [], departures = [], records = new Map();
    let at = 1800000000000, alarm = null, upgrading = null, queue = Promise.resolve();
    const serial = task => { const run = queue.then(task); queue = run.catch(() => {}); return run; };
    const storage = {
        getAlarm: async () => alarm, setAlarm: async value => { alarm = value; },
        get: async key => structuredClone(records.get(key)),
        put: async (key, value) => { for (const [name, record] of typeof key === 'string' ? [[key, value]] : Object.entries(key)) records.set(name, structuredClone(record)); },
        delete: async key => { for (const name of [key].flat()) records.delete(name); },
        list: async ({ prefix = '', limit = Infinity } = {}) => new Map([...records].filter(([key]) => key.startsWith(prefix)).slice(0, limit))
    };
    const state = { storage, getWebSockets: () => matchSockets, acceptWebSocket: socket => { matchSockets.push(socket); } };
    const connection = id => [...people.values()].find(person => person.identity?.id === id);
    const lobby = createLobby({ gameNight: true, now: () => at, limits: { defaultSlow: 0, roomPerDevice: 1 }, send: (id, frame) => {
        const person = connection(id);
        if (frame.t === 'part' && person) { const ref = lobby.arcadeRoomRef(frame.ch, false); if (ref) departures.push({ scope: { room: frame.ch, ref }, subject: person.sid }); }
        // lobby-do.mjs adds the arcade flags to the hello; without them the client disables every game.
        lobbySockets.get(id)?.send(JSON.stringify(arcadeHello(frame)));
    } });
    const transports = new Map(['chess', 'turdspades', 'turdanoid'].map(name => [name, createArcadeTransport({
        name, state,
        current: scope => { const person = connection(scope.actor); if (!person || !lobbySockets.has(scope.actor)) return null; const member = lobby.arcadeActor(scope, false); return member ? { ...person.identity, ...member, socket: person } : null; },
        active: async () => true, charge: async () => true, allowed: () => true,
        approve: async actor => (await lobby.approveArcade(actor))?.ok === true
    })]));
    async function reconcile() {
        for (const departure of departures.splice(0)) for (const transport of transports.values()) await transport.revoke(departure.scope, departure.subject);
        for (const transport of transports.values()) transport.reconcile();
    }
    globalThis.WebSocketPair = class { constructor() { this[0] = {}; this[1] = upgrading; } };
    const retire = (socket, transport) => serial(() => retireMatchSocket(socket, transport, matchSockets));
    async function phone(nick) {
        const sid = randomUUID(), session = { betaSid: sid, betaInviteVersion: '1' };
        const person = { nick, sid, identity: null, matches: new Map() }; people.set(nick, person);
        const phone = viewport.width < 600;
        const context = await browser.newContext({ viewport, hasTouch: phone }); contexts.push(context);
        await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        await context.route(url => url.pathname === lobbyPath, async route => {
            const response = await route.fetch();
            await route.fulfill({ response, body: (await response.text()).replace('<head>', '<head><script src="/beta/bootstrap.js"></script>') });
        });
        await context.route('**/beta/bootstrap.js', route => route.fulfill({ contentType: 'text/javascript', body: 'window.HangoutBootstrap={};' }));
        await context.route(url => /-ticket$/.test(url.pathname) && !!arcadeGame(url.pathname), async route => {
            const game = arcadeGame(new URL(route.request().url()).pathname), scope = arcadeRoomRequest(route.request().postDataJSON());
            if (!transports.has(game) || !scope) return route.fulfill({ status: 404, json: { error: 'not found' } });
            const response = await serial(() => transports.get(game).issue(scope, session));
            await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
        });
        const page = await context.newPage();
        if (phone) await page.emulateMedia({ media: 'screen', features: [{ name: 'pointer', value: 'coarse' }] });
        person.page = page; person.errors = [];
        page.on('pageerror', error => person.errors.push(error.message));
        await page.routeWebSocket(url => url.pathname.endsWith('/lobby'), socket => {
            const identity = { id: 'c' + randomBytes(16).toString('hex'), dev: `device-${nick}`, iph: `ip-${nick}`, role: 'fan', account: '', admin: false, ...session };
            person.identity = identity; lobbySockets.set(identity.id, socket);
            socket.onMessage(raw => { at += 5000; void serial(async () => { await lobby.message(identity.id, String(raw)); await reconcile(); }); });
            socket.onClose(() => { lobbySockets.delete(identity.id); void serial(async () => { await lobby.disconnect(identity.id); await reconcile(); }); });
            lobby.connect(identity);
        });
        await page.routeWebSocket(url => /-match$/.test(url.pathname) && transports.has(arcadeGame(url.pathname)), route => {
            const game = arcadeGame(new URL(route.url()).pathname), transport = transports.get(game);
            // A server close (ban, kick, replaced seat) retires the socket the same way a browser close does.
            const socket = matchSocket(route, closed => void retire(closed, transport));
            route.onMessage(raw => void serial(() => transport.receive(socket, String(raw))));
            route.onClose(() => void retire(socket, transport));
            void serial(async () => { upgrading = socket; try { const refused = await transport.upgrade(route.protocols().join(', '), session); socket.close(1008, `upgrade refused ${refused.status}`); }
                catch (error) { if (!(error instanceof RangeError) || !matchSockets.includes(socket)) throw error; person.matches.set(game, socket); } finally { upgrading = null; } });
        });
        await page.goto(`${origin}${lobbyPath}?preview=${preview}&relay=${encodeURIComponent(origin.replace(/^http/, 'ws') + '/__hangout-relay/sessions/family-alpha-regrade')}`);
        await page.locator('[data-nick]').fill(nick); await page.locator('[data-enter]').click(); await expect(page.locator('[data-connection]')).toHaveText('Connected');
        return page;
    }
    async function invite(host, guest, nick) {
        await host.getByRole('button', { name: 'Invite players' }).click();
        await host.getByRole('button', { name: `Invite ${nick}`, exact: true }).click();
        await guest.locator('[data-game-offer]').getByRole('button', { name: 'Join Game Night' }).click();
        await expect(guest.getByRole('region', { name: /Game Night/ })).toBeVisible();
        if (await host.locator('[data-invite-dialog][open]').count()) await host.keyboard.press('Escape');
    }
    return { phone, invite, people, errors: () => [...people.values()].flatMap(person => person.errors), close: async () => { await Promise.all(contexts.map(context => context.close())); } };
}

// Retries `read` until `ok` accepts its value, so a table that is still dealing is not sampled once and misjudged.
async function until(read, ok, describe, timeout = 15000) {
    for (const deadline = Date.now() + timeout; ;) {
        const value = await read();
        if (ok(value)) return value;
        if (Date.now() > deadline) throw new Error(describe(value));
        await new Promise(resolve => setTimeout(resolve, 200));
    }
}

// What the Turdanoid table is showing: its phase, the wall's brick total and whether the canvas has been drawn on.
const brickWall = board => board.evaluate(table => {
    const totals = [...table.querySelectorAll('[data-brick-score]')].map(node => Number(/\/(\d+) bricks/.exec(node.textContent)?.[1] || 0));
    const canvas = table.querySelector('canvas'), colors = new Set();
    try {
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        for (let index = 0; index < pixels.length; index += 4 * 97) if (pixels[index + 3]) colors.add(pixels.slice(index, index + 3).join());
    } catch { /* no readable canvas: not painted */ }
    return { phase: table.dataset.phase || '', bricks: Math.max(0, ...totals), painted: colors.size >= 4 };
});

// Every enabled, visible control's box once it is scrolled to the nearest edge.
// All of it runs inside one task and every scroll position is put back before
// it returns, so the page is framed exactly as the player left it.
const measureLayout = page => page.evaluate(() => {
    const all = [...document.querySelectorAll('*')], before = new Map(), home = { top: scrollY, left: scrollX, behavior: 'instant' }, controls = [];
    for (const element of all) if (element.scrollTop || element.scrollLeft) before.set(element, [element.scrollTop, element.scrollLeft]);
    try {
        for (const element of document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, summary')) {
            if (element.disabled || element.closest('[inert], [aria-disabled="true"]') || !element.checkVisibility({ visibilityProperty: true })) continue;
            if (element.localName === 'a' && getComputedStyle(element).display === 'inline') continue;
            // A checkbox or radio is pressed through its label.
            const target = element.matches('input[type="checkbox"], input[type="radio"]') ? element.closest('label') || element : element;
            target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
            const box = target.getBoundingClientRect();
            if (!box.width && !box.height) continue;
            const text = element.matches('select, input, textarea') ? '' : element.textContent;
            const name = (element.getAttribute('aria-label') || text || element.getAttribute('placeholder') || element.name || element.id || '').replace(/\s+/g, ' ').trim().slice(0, 60);
            controls.push({ label: `${element.localName} "${name}"`, x: box.x, y: box.y, width: box.width, height: box.height });
        }
    } finally {
        for (const element of all) {
            const [top, left] = before.get(element) || [0, 0];
            if (element.scrollTop !== top || element.scrollLeft !== left) element.scrollTo({ top, left, behavior: 'instant' });
        }
        scrollTo(home);
    }
    return { scrollWidth: document.documentElement.scrollWidth, controls };
});

async function capture(browser, origin, sourceRoot, spec, viewport, target, sha, base) {
    const fixture = await createFixture(browser, origin, sourceRoot, viewport);
    const nicks = ['HostExample', 'GuestWest', 'GuestNorth', 'GuestEast'].slice(0, spec.seats);
    try {
        const pages = await Promise.all(nicks.map(nick => fixture.phone(nick)));
        const host = pages[0];
        const start = host.getByRole('button', { name: /Game Night/ });
        if (!await start.isVisible()) await host.locator('.phonetabs [data-show="rooms"]').click();
        await start.click();
        await expect(host.getByRole('region', { name: /Game Night/ })).toBeVisible();
        for (let index = 1; index < pages.length; index++) await fixture.invite(host, pages[index], nicks[index]);
        for (const page of pages) {
            const picker = page.getByRole('combobox', { name: 'Switch game' });
            await until(() => picker.locator(`option[value="${spec.game}"]`).isEnabled(), ok => ok,
                () => `${spec.label} stays disabled on the game picker (arcade module still loading?).`);
            await picker.selectOption(spec.game);
        }
        await host.getByRole('button', { name: spec.button }).click();
        for (let index = 1; index < spec.seats; index++) await pages[index].getByRole('button', { name: spec.joins[index - 1] }).click();
        for (const [index, page] of pages.entries()) {
            const board = page.locator(spec.board);
            await expect(board).toBeVisible();
            await until(async () => (await page.locator(spec.status).innerText()).trim(), status => seatStarted(spec, index, status),
                status => `${spec.label} did not start with all ${spec.seats} seats occupied (${nicks[index]}: ${status || 'empty status'}).`);
            if (spec.proof) {
                await until(() => board.locator(spec.proof.selector).count(), count => count >= spec.proof.min,
                    count => `${spec.label} shows ${count} of ${spec.proof.min} ${spec.proof.selector} for ${nicks[index]}.`);
            } else {
                await until(() => brickWall(board), brickWallShown, wall => `Turdanoid race has no painted wall for ${nicks[index]} (${JSON.stringify(wall)}).`);
            }
        }
        const findings = [];
        for (const [index, page] of pages.entries()) {
            for (const finding of layoutFindings(await measureLayout(page), viewport)) findings.push(`${nicks[index]}: ${finding}`);
        }
        if (strict && findings.length) throw new Error(`Layout findings at ${viewport.name}:\n${findings.join('\n')}`);
        // The shot is the host's viewport, so the board has to be in it.
        await host.locator(spec.board).scrollIntoViewIfNeeded();
        await expect(host.locator(spec.board)).toBeInViewport();
        await host.waitForTimeout(250);
        if (fixture.errors().length) throw new Error(`Browser errors: ${fixture.errors().join('; ')}`);
        const buffer = await host.screenshot({ type: 'png', fullPage: false, animations: 'disabled' });
        await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, buffer);
        return { game: spec.label, version: spec.version, sha, viewport: viewport.name, path: path.relative(base, target), notes: 'Live in-process Game Night fixture; all seats joined; seated board/deal/wall visible; host screenshot.', findings };
    } finally { await fixture.close(); }
}

export async function main() {
    assertPort(port);
    const staging = `${output}.partial`;
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    const temp = await mkdtemp(path.join(tmpdir(), 'family-alpha-regrade-'));
    const manifest = [];
    let browser, site, failure = null;
    try {
        const roots = new Map(), prepared = new Set();
        for (const entry of versions) {
            const treeSha = entry.treeSha || entry.sha;
            const root = path.join(temp, treeSha);
            if (!prepared.has(treeSha)) { await mkdir(root, { recursive: true }); archive(treeSha, root); prepared.add(treeSha); }
            roots.set(entry.sha, root);
        }
        site = await staticServer(roots.get(versions[0].sha));
        browser = await chromium.launch({ headless: true });
        for (const entry of versions) {
            const root = roots.get(entry.sha), activeGames = entry.games || [entry.game];
            site.setRoot(root);
            for (const key of activeGames) for (const viewport of viewports) {
                const spec = { ...gameSpecs[key], label: ({ 'partners-spades': 'partners Spades', 'four-player-spades': 'four-player Spades' })[key] || key, version: entry.version };
                const target = path.join(staging, entry.version, key, `${viewport.name}.png`);
                const shot = await capture(browser, site.origin, root, spec, viewport, target, entry.sha, staging);
                manifest.push(shot);
                process.stdout.write(`Captured ${entry.version} ${key} ${viewport.name} (${shot.findings.length} layout findings)\n`);
            }
        }
        await writeFile(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
        await rm(output, { recursive: true, force: true });
        await rename(staging, output);
        process.stdout.write(`Wrote ${manifest.length} PNGs and manifest.json\n`);
    } catch (error) { failure = error; }
    // Each step runs even if an earlier one throws; a failed run never leaves partial shots behind.
    const cleanup = settle([
        async () => { if (browser) await browser.close(); },
        async () => { if (site) await site.close(); },
        () => rm(temp, { recursive: true, force: true }),
        () => rm(staging, { recursive: true, force: true })
    ]);
    if (failure) { await cleanup.catch(() => {}); throw failure; }
    await cleanup;
    return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        if (['EPERM', 'EACCES', 'EADDRINUSE'].includes(error?.code) && /listen|bind/i.test(error.syscall || error.message)) {
            process.stderr.write(`Local server bind blocked (${error.code}): ${error.message}\nNo server was started; script is ready to run where localhost binds are permitted.\n`);
        } else process.stderr.write(`${error?.stack || error}\n`);
        process.exitCode = 1;
    });
}
