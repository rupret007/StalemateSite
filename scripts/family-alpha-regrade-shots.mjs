#!/usr/bin/env node
// Capture deterministic seated Game Night states for the family-alpha visual re-grade.
// Run at 01:00 CT with: node scripts/family-alpha-regrade-shots.mjs
// Optional: REGRADE_OUTPUT_DIR=/path/to/regrade-20261115
// The default output is the requested re-grade delivery folder under Documents.
// Uses the repository's installed @playwright/test (no install step) and Chromium.

import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { chromium, expect } = require('@playwright/test');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.env.REGRADE_OUTPUT_DIR || path.join(homedir(), 'Documents', 'bob-overnight-inject', 'regrade-20261115'));
const port = Number(process.env.REGRADE_PORT || 8765);
const viewports = [{ name: '390x844', width: 390, height: 844 }, { name: '1440x900', width: 1440, height: 900 }];
const versions = [
    { version: 'current', sha: '6a773061aa01d6966403da3960ac29f1b056ae19', games: ['chess', 'partners-spades', 'four-player-spades', 'turdanoid'] },
    { version: 'new', sha: '74280151ceb88d7beb614359a276d06dd156c9a9', game: 'chess' },
    { version: 'new', sha: '87a656c68994eedf577418a55a5622e36e2993d3', games: ['partners-spades', 'four-player-spades'] },
    { version: 'new', sha: '3bdd0e3bd7038d770cce099faa6da4b5aa49defc', game: 'turdanoid' }
];
const gameSpecs = {
    chess: { game: 'chess', seats: 2, button: 'Open Chess match', joins: ['Join as Black'], board: '.arcade-chess-board', status: '[data-chess-status]' },
    'partners-spades': { game: 'turdspades', seats: 2, button: 'Open 2-player Spades', joins: ['Join West'], board: '[data-spades-table]', status: '[data-spades-status]' },
    'four-player-spades': { game: 'turdspades', seats: 4, button: 'Open 4-player Spades', joins: ['Join West', 'Join North', 'Join East'], board: '[data-spades-table]', status: '[data-spades-status]' },
    turdanoid: { game: 'turdanoid', seats: 2, button: 'Open Turdanoid race', joins: ['Join Turdanoid race'], board: '[data-brick-match]', status: '[data-brick-status]' }
};
const lobbyPath = '/r/45662413410ed051/lobby/';
const preview = 'local-preview-key-0001';
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json' };

function archive(sha, directory) {
    const bytes = execFileSync('git', ['archive', sha], { cwd: repo, maxBuffer: 512 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', directory], { input: bytes, maxBuffer: 512 * 1024 * 1024 });
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
    const { createLobby } = await import(pathToFileURL(path.join(sourceRoot, 'hangout-worker/src/lobby-core.mjs')));
    const { arcadeGame, arcadeRoomRequest, createArcadeTransport } = await import(pathToFileURL(path.join(sourceRoot, 'hangout-worker/src/arcade-transport.mjs')));
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
        lobbySockets.get(id)?.send(JSON.stringify(frame));
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
    const retire = async (socket, transport) => {
        if (socket.readyState !== 1) return;
        const scope = socket.deserializeAttachment(); socket.serializeAttachment({ ...scope, retired: true }); socket.readyState = 3;
        try { await transport.presenceChanged(scope); }
        finally { const index = matchSockets.indexOf(socket); if (index !== -1) matchSockets.splice(index, 1); }
    };
    async function phone(nick) {
        const sid = randomUUID(), session = { betaSid: sid, betaInviteVersion: '1' };
        const person = { nick, sid, identity: null, matches: new Map() }; people.set(nick, person);
        const context = await browser.newContext({ viewport, hasTouch: viewport.width < 600 }); contexts.push(context);
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
        const page = await context.newPage(); person.page = page; person.errors = [];
        page.on('pageerror', error => person.errors.push(error.message));
        await page.routeWebSocket(url => url.pathname.endsWith('/lobby'), socket => {
            const identity = { id: 'c' + randomBytes(16).toString('hex'), dev: `device-${nick}`, iph: `ip-${nick}`, role: 'fan', account: '', admin: false, ...session };
            person.identity = identity; lobbySockets.set(identity.id, socket);
            socket.onMessage(raw => { at += 5000; void serial(async () => { await lobby.message(identity.id, String(raw)); await reconcile(); }); });
            socket.onClose(() => { lobbySockets.delete(identity.id); void serial(async () => { await lobby.disconnect(identity.id); await reconcile(); }); });
            lobby.connect(identity);
        });
        await page.routeWebSocket(url => /-match$/.test(url.pathname) && transports.has(arcadeGame(url.pathname)), route => {
            const game = arcadeGame(new URL(route.url()).pathname), transport = transports.get(game); let attachment = null;
            const socket = { readyState: 1, serializeAttachment: value => { attachment = value; }, deserializeAttachment: () => attachment,
                send: raw => { if (socket.readyState === 1) route.send(raw); },
                close: (code = 1000, reason = '') => { if (socket.readyState === 1) { socket.readyState = 3; void route.close({ code, reason }); } } };
            route.onMessage(raw => void serial(() => transport.receive(socket, String(raw))));
            route.onClose(() => void serial(() => retire(socket, transport)));
            void serial(async () => { upgrading = socket; try { const refused = await transport.upgrade(route.protocols().join(', '), session); socket.readyState = 3; await route.close({ code: 1008, reason: `upgrade refused ${refused.status}` }); }
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

async function capture(browser, origin, sourceRoot, spec, viewport, target, sha) {
    const fixture = await createFixture(browser, origin, sourceRoot, viewport);
    const nicks = ['HostExample', 'GuestWest', 'GuestNorth', 'GuestEast'].slice(0, spec.seats);
    try {
        const pages = await Promise.all(nicks.map(nick => fixture.phone(nick)));
        const host = pages[0];
        await host.getByRole('button', { name: /Game Night/ }).click();
        await expect(host.getByRole('region', { name: /Game Night/ })).toBeVisible();
        for (let index = 1; index < pages.length; index++) await fixture.invite(host, pages[index], nicks[index]);
        for (const page of pages) {
            const picker = page.getByRole('combobox', { name: 'Switch game' });
            await expect(picker.locator(`option[value="${spec.game}"]`)).toBeEnabled();
            await picker.selectOption(spec.game);
        }
        await host.getByRole('button', { name: spec.button }).click();
        for (let index = 1; index < spec.seats; index++) await pages[index].getByRole('button', { name: spec.joins[index - 1] }).click();
        for (const page of pages.slice(0, spec.seats)) {
            await expect(page.locator(spec.board)).toBeVisible();
            const status = (await page.locator(spec.status).innerText()).trim();
            if (!status || /waiting for players|waiting for opponent|waiting for .*player/i.test(status)) {
                throw new Error(`${spec.label} did not start with all ${spec.seats} seats occupied (${status || 'empty status'}).`);
            }
            const board = page.locator(spec.board);
            if (spec.game === 'chess' && await board.locator('[data-square]').count() < 32) throw new Error('Chess board has no complete starting position.');
            if (spec.game === 'turdspades' && await board.locator('[data-card]').count() < 1) throw new Error('Spades table has no dealt cards.');
            if (spec.game === 'turdanoid' && await board.locator('canvas, [data-wall], [data-brick]').count() < 1) throw new Error('Turdanoid race has no visible wall.');
        }
        for (const page of pages) {
            const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
            if (layout.width > layout.viewport + 1) throw new Error(`Horizontal overflow at ${viewport.width}x${viewport.height}.`);
            const controls = page.locator('button:visible, a:visible, input:visible, select:visible');
            for (let i = 0; i < await controls.count(); i++) {
                const control = controls.nth(i);
                if (!(await control.isEnabled().catch(() => false))) continue;
                await control.scrollIntoViewIfNeeded();
                const box = await control.boundingBox();
                if (!box || box.width < 24 || box.height < 24 || box.x < 0 || box.y < 0 || box.x + box.width > viewport.width + 1 || box.y + box.height > viewport.height + 1) {
                    throw new Error(`Unreachable or undersized control at ${viewport.width}x${viewport.height}.`);
                }
            }
        }
        await host.waitForTimeout(250);
        if (fixture.errors().length) throw new Error(`Browser errors: ${fixture.errors().join('; ')}`);
        const buffer = await host.screenshot({ type: 'png', fullPage: false, animations: 'disabled' });
        await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, buffer);
        return { game: spec.label, version: spec.version, sha, viewport: `${viewport.width}x${viewport.height}`, path: path.relative(output, target), notes: 'Live in-process Game Night fixture; all seats joined; seated board/deal/wall visible; host screenshot.' };
    } finally { await fixture.close(); }
}

async function main() {
    if (!Number.isInteger(port) || port < 8700 || port > 8799) throw new Error('REGRADE_PORT must be within 8700–8799.');
    await rm(output, { recursive: true, force: true });
    await mkdir(output, { recursive: true });
    const temp = await mkdtemp(path.join(tmpdir(), 'family-alpha-regrade-'));
    const manifest = [];
    let browser, site, complete = false;
    try {
        const roots = new Map();
        for (const entry of versions) {
            if (roots.has(entry.sha)) continue;
            const root = path.join(temp, entry.sha); await mkdir(root, { recursive: true }); archive(entry.sha, root); roots.set(entry.sha, root);
        }
        site = await staticServer(roots.get(versions[0].sha));
        browser = await chromium.launch({ headless: true });
        for (const entry of versions) {
            const root = roots.get(entry.sha), activeGames = entry.games || [entry.game];
            site.setRoot(root);
            for (const key of activeGames) for (const viewport of viewports) {
                const spec = { ...gameSpecs[key], label: ({ 'partners-spades': 'partners Spades', 'four-player-spades': 'four-player Spades' })[key] || key, version: entry.version };
                const target = path.join(output, entry.version, key, `${viewport.name}.png`);
                manifest.push(await capture(browser, site.origin, root, spec, viewport, target, entry.sha));
                process.stdout.write(`Captured ${entry.version} ${key} ${viewport.name}\n`);
            }
        }
        await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
        process.stdout.write(`Wrote ${manifest.length} PNGs and manifest.json\n`);
        complete = true;
    } finally {
        if (browser) await browser.close();
        if (site) await site.close();
        await rm(temp, { recursive: true, force: true });
        if (!complete) await rm(output, { recursive: true, force: true });
    }
}

main().catch(error => {
    if (error?.code === 'EPERM' && /listen|bind/i.test(error.syscall || error.message)) {
        process.stderr.write(`Local server bind blocked (${error.code}): ${error.message}\nNo server was started; script is ready to run where localhost binds are permitted.\n`);
    } else process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
});
