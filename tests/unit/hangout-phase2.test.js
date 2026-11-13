import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { injectJoinGuide, isJoinNavigation, shouldGuideJoin } from '../../hangout/join-guide.mjs';
import {
    LAST_ROOM_EMPTY,
    LAST_ROOM_KEY,
    choiceHref,
    mountShortcuts,
    placeFromShortcut,
    readPlace,
    rememberPlace,
    safeChoiceHref,
    showEmptyLast
} from '../../hangout/last-room.mjs';
import {
    RECONNECT_COPY,
    probeUrl,
    shouldReconnect,
    startOfflineRetry
} from '../../hangout/offline-retry.mjs';
import {
    HOME_LABEL,
    HOST_ASK,
    IPHONE_LIMIT,
    JUMP_LABEL,
    OPEN_IN_APP_TITLE,
    classifyInvite,
    detectInstalled,
    fillOpenInApp,
    hangoutHomePath,
    inviteSignal,
    jumpIn,
    mountHostAsk,
    mountOpenInApp,
    openInAppDecision,
    openInAppLines,
    safeHomeHref
} from '../../hangout/open-in-app.mjs';
import { isOfflineAsset, offlineAssetUrls, offlineDocument } from '../../hangout/sw-policy.mjs';
import { cannotOpenLine, parseDoor, placeHref, mountDoor, retainDoorQuery, guardGameNightFlag } from '../../hangout/door.mjs';
import { repairAbsentJoin } from '../../hangout/join-absent.mjs';
import { injectLobbyDoor, isLobbyNavigation, retainLobbyGameNight, revealClosedDoor } from '../../hangout/lobby-door.mjs';
import {
    EMPTY_COPY,
    hrefForPlace,
    loadOpenPlaces,
    placesFromPayload,
    publicPlace,
    renderPlaces,
    safeReadPath
} from '../../hangout/whos-here.mjs';

const repoRoot = process.cwd();
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const MARKER = 'not-a-real-invite-value';

function memoryStorage(initial = {}) {
    const data = new Map(Object.entries(initial));
    return {
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => { data.set(key, String(value)); }
    };
}

function page(head = '', body = '') {
    const doc = document.implementation.createHTMLDocument('');
    doc.head.innerHTML = head;
    doc.body.innerHTML = body;
    return doc;
}

describe('invite links open in the installed app', () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'manifest.json'), 'utf8'));
    const manifestUrl = new URL('https://stalemate.band/manifest.json');

    function covers(target) {
        const scope = new URL(manifest.scope, manifestUrl);
        const url = new URL(target, manifestUrl);
        return url.href.startsWith(scope.href);
    }

    it('keeps the entry as start_url and the whole site in scope so invite URLs are inside the app', () => {
        expect(manifest.start_url).toBe('hangout/');
        expect(manifest.scope).toBe('./');
        expect(manifest.handle_links).toBe('preferred');
        expect(manifest.launch_handler.client_mode).toEqual(['navigate-existing', 'auto']);
        expect(covers('/hangout/')).toBe(true);
        expect(covers('/join/')).toBe(true);
        expect(covers('/join/#k=1&s=1&g=1&e=1')).toBe(true);
        expect(covers('/beta/game-night/guest')).toBe(true);
        expect(covers('/r/45662413410ed051/')).toBe(true);
        expect(new URL(manifest.start_url, manifestUrl).href.startsWith(new URL(manifest.scope, manifestUrl).href)).toBe(true);
    });

    it('leads with one action and keeps the iPhone limit to one line', () => {
        expect(openInAppDecision({ link: 'valid', installed: 'unknown' })).toEqual({
            show: true, action: 'jump', installed: 'unknown'
        });
        expect(openInAppDecision({ link: 'invalid', installed: 'unknown' })).toEqual({
            show: true, action: 'home', installed: 'unknown'
        });
        expect(openInAppDecision({ link: 'absent', hostPreview: true }).show).toBe(false);
        expect(openInAppDecision({ standalone: true, link: 'valid' }).show).toBe(false);
        expect(openInAppLines({ ios: true, action: 'jump', place: 'hangout' })).toEqual([IPHONE_LIMIT]);
        expect(IPHONE_LIMIT).toMatch(/Safari/);
        expect(IPHONE_LIMIT).not.toMatch(/cannot take this link/);
        expect(openInAppLines({ ios: false, action: 'jump' })).toEqual([]);
        expect(openInAppLines({ ios: true, action: 'home', place: 'webjam', led: true, alreadyHome: true })).toEqual([]);
        expect(openInAppLines({ ios: true, action: 'home', place: 'webjam', led: true })).toEqual([IPHONE_LIMIT]);
        const jump = fillOpenInApp(document, { ios: true, installed: 'unknown', action: 'jump', place: 'hangout' });
        expect(jump.getAttribute('aria-label')).toBe(OPEN_IN_APP_TITLE);
        expect(jump.querySelector('button').textContent).toBe(JUMP_LABEL);
        expect(jump.querySelectorAll('p')).toHaveLength(1);
        expect(jump.querySelector('p').textContent).toBe(IPHONE_LIMIT);
        const home = fillOpenInApp(document, {
            ios: false, action: 'home', place: 'webjam', homeHref: '/hangout/'
        });
        expect(home.querySelector('a').textContent).toBe(HOME_LABEL);
        expect(home.querySelector('a').getAttribute('href')).toBe('/hangout/');
        expect(home.querySelector('p').textContent).toBe(HOST_ASK);
        expect(safeHomeHref('javascript:alert(1)')).toBe('');
        expect(safeHomeHref('/hangout/?invite=1')).toBe('');
        expect(hangoutHomePath('https://stalemate.band/hangout/open-in-app.mjs')).toBe('/hangout/');
        expect(hangoutHomePath('https://jeffstory.github.io/StalemateSite/hangout/open-in-app.mjs')).toBe('/StalemateSite/hangout/');
    });

    it('does not copy an invite value into the guidance', async () => {
        expect(inviteSignal(`?r=${MARKER}`, '')).toBe(true);
        expect(inviteSignal('', `#k=${MARKER}&s=1&g=1&e=1`)).toBe(true);
        expect(inviteSignal('', '')).toBe(false);
        const doc = page(
            '<meta name="hangout-open-in-app" content="invite"><meta name="hangout-place" content="hangout">',
            '<p id="kept">Stay</p>'
        );
        const storage = memoryStorage();
        const shown = await mountOpenInApp(doc, {
            userAgent: IPHONE,
            maxTouchPoints: 0,
            storage,
            matchMedia: () => ({ matches: false }),
            navigatorStandalone: false,
            installed: 'unknown',
            search: '',
            hash: `#r=${MARKER}&h=${MARKER}`,
            homeHref: '/hangout/'
        });
        expect(shown).toBe(true);
        expect(doc.body.textContent).toContain(HOME_LABEL);
        expect(doc.body.textContent).toContain('Safari');
        expect(doc.body.textContent).not.toContain(MARKER);
        expect(doc.body.textContent).not.toContain('Jump');
        expect(readPlace(storage)).toBe('hangout');
        expect(await detectInstalled({})).toBe('unknown');
        expect(await detectInstalled({ getInstalledRelatedApps: async () => [] })).toBe('unknown');
        expect(await detectInstalled({ getInstalledRelatedApps: async () => [{ platform: 'webapp' }] })).toBe('installed');
    });

    it('adds the guidance to a WebJam join navigation and skips invite queries', () => {
        expect(isJoinNavigation('https://stalemate.band/join/')).toBe(true);
        expect(isJoinNavigation('https://jeffstory.github.io/StalemateSite/join')).toBe(true);
        expect(isJoinNavigation('https://stalemate.band/join/session.js')).toBe(false);
        expect(shouldGuideJoin('https://stalemate.band/join/', { method: 'GET', mode: 'navigate' })).toBe(true);
        expect(shouldGuideJoin('https://stalemate.band/join/?invite=value', { method: 'GET', mode: 'navigate' })).toBe(false);
        expect(shouldGuideJoin('https://stalemate.band/join/', { method: 'GET', mode: 'cors' })).toBe(false);
        expect(shouldGuideJoin('https://stalemate.band/beta/game-night/guest', { method: 'GET', mode: 'navigate' })).toBe(false);
        const html = '<!doctype html><html><head><title>Join</title></head><body><p>Open the invite link from your host.</p></body></html>';
        const next = injectJoinGuide(html, 'https://stalemate.band/hangout/');
        expect(next).toContain('src="https://stalemate.band/hangout/open-in-app.mjs"');
        expect(next).toContain('href="https://stalemate.band/hangout/open-in-app.css"');
        expect(next).toContain('content="webjam"');
        expect(next).not.toContain(MARKER);
        expect(injectJoinGuide(next, 'https://stalemate.band/hangout/')).toBe(next);
        expect(injectJoinGuide(html, 'https://evil.example/hangout/')).toBe(html);
        const room = readFileSync(join(repoRoot, 'r/45662413410ed051/index.html'), 'utf8');
        expect(room).toContain('name="hangout-open-in-app" content="invite"');
        expect(room).toContain('src="../../hangout/open-in-app.mjs"');
    });
});

describe('who’s here', () => {
    const openArt = { name: '#art-live', kind: 'art', title: 'Drawing room', count: 2, max: 8, locked: false, key: false, nick: 'SecretNick', secret: MARKER };
    const table = { name: '#game-abc123xdef456', kind: 'game', title: 'Royal Flush Chess', count: 2, max: 8, locked: true, key: false, email: 'hidden@example.test' };

    it('keeps open rooms and occupied tables and drops personal fields', () => {
        expect(publicPlace(openArt)).toEqual({ kind: 'art', title: 'Drawing room', count: 2 });
        expect(publicPlace(table)).toEqual({ kind: 'game', title: 'Royal Flush Chess', count: 2 });
        expect(publicPlace({ ...openArt, count: 0 })).toBeNull();
        expect(publicPlace({ ...openArt, locked: true })).toBeNull();
        expect(publicPlace({ ...openArt, key: true })).toBeNull();
        expect(publicPlace({ ...table, count: 8 })).toBeNull();
        expect(publicPlace({ kind: 'chat', title: 'Nope', count: 1, max: 8, locked: 'false', key: false })).toBeNull();
        const places = placesFromPayload({
            kind: 'guest',
            role: 'fan',
            email: 'hidden@example.test',
            rooms: [openArt, { ...openArt, title: 'Empty', count: 0 }, { ...openArt, title: 'Private chat', locked: true }, table],
            grant: MARKER
        });
        expect(places).toEqual([
            { kind: 'art', title: 'Drawing room', count: 2 },
            { kind: 'game', title: 'Royal Flush Chess', count: 2 }
        ]);
        const root = document.createElement('section');
        root.innerHTML = '<p data-here-status role="status"></p><ul data-here-list hidden></ul>';
        renderPlaces(root, places, safeChoiceHref);
        expect(root.textContent).toContain('Drawing room');
        expect(root.textContent).toContain('2 here · Draw together');
        expect(root.textContent).toContain('Royal Flush Chess');
        expect(root.textContent).not.toContain('SecretNick');
        expect(root.textContent).not.toContain(MARKER);
        expect(root.textContent).not.toContain('#game-');
        expect(root.textContent).not.toContain('hidden@example.test');
        expect(root.querySelectorAll('a')).toHaveLength(2);
        expect(root.querySelector('a').getAttribute('href')).toBe('door.html?kind=draw&title=Drawing+room&count=2&via=art');
        expect(root.querySelectorAll('a')[1].getAttribute('href')).toBe('door.html?kind=game-night&title=Royal+Flush+Chess&count=2&via=game&game-night=1');
        expect(hrefForPlace({ kind: 'watch', title: 'Watch party', count: 3 })).toBe('door.html?kind=watch&title=Watch+party&count=3&via=watch');
        expect(hrefForPlace({ kind: 'jam', title: 'Friday jam' })).toBe('./?go=webjam');
        expect(hrefForPlace({ kind: 'art', title: 'invite room' })).toBe('door.html?kind=draw&via=art');
        renderPlaces(root, [], safeChoiceHref);
        expect(root.querySelector('[data-here-status]').textContent).toBe(EMPTY_COPY);
        expect(root.querySelector('[data-here-list]').hidden).toBe(true);
    });

    it('reads only the existing state GET and ignores a non-directory body', async () => {
        expect(safeReadPath('/beta/state')).toBe(true);
        expect(safeReadPath('/beta/game-night/invitation/issue')).toBe(false);
        expect(safeReadPath('/join/?invite=1')).toBe(false);
        const calls = [];
        const fetchImpl = async (url, options) => {
            calls.push({ url, options });
            return {
                ok: true,
                headers: { get: () => 'application/json' },
                json: async () => ({ kind: 'guest', role: 'fan', email: 'hidden@example.test' })
            };
        };
        expect(await loadOpenPlaces(fetchImpl, ['/beta/state', '/beta/game-night/invitation/issue'])).toEqual([]);
        expect(calls.map((call) => call.url)).toEqual(['/beta/state']);
        expect(calls[0].options.method).toBe('GET');
        expect(calls[0].options.redirect).toBe('error');
        const failed = await loadOpenPlaces(async () => { throw new Error('offline'); }, ['/beta/state']);
        expect(failed).toEqual([]);
    });
});

describe('offline reconnect', () => {
    it('shows the trinity mark and the reconnect line without reading a token', () => {
        const html = readFileSync(join(repoRoot, 'hangout/offline.html'), 'utf8');
        expect(html).toContain('M32.00 24.43');
        expect(html).toContain('#E87900');
        expect(html).toContain('You’re offline, we’ll reconnect');
        expect(html).toContain("from './offline-retry.mjs'");
        expect(html).not.toMatch(/location\.(search|hash|href)/);
        expect(html).not.toContain(MARKER);
        const branded = offlineDocument('<head><title>Offline</title></head>', 'https://stalemate.band/');
        expect(branded).toContain('<base href="https://stalemate.band/hangout/">');
        expect(branded).not.toContain(MARKER);
        expect(offlineAssetUrls('https://stalemate.band/').every((href) => !/invite|grant|beta/.test(href))).toBe(true);
        expect(isOfflineAsset('https://stalemate.band/hangout/offline-retry.mjs', 'https://stalemate.band/')).toBe(true);
        expect(isOfflineAsset('https://stalemate.band/join/?invite=1', 'https://stalemate.band/')).toBe(false);
    });

    it('probes the path and reloads when the network answers', async () => {
        const fetched = [];
        let reloaded = 0;
        const timers = [];
        const stop = startOfflineRetry({
            location: { pathname: '/join/', search: `?invite=${MARKER}`, hash: `#k=${MARKER}` },
            navigator: { onLine: true },
            fetch: async (url) => {
                fetched.push(url);
                return { body: { cancel: async () => {} } };
            },
            addEventListener() {},
            setTimeout(fn) { timers.push(fn); return timers.length; },
            clearTimeout() {},
            reload() { reloaded += 1; },
            setStatus() {}
        });
        expect(fetched).toEqual([]);
        await timers[0]();
        expect(fetched).toEqual(['/join/']);
        expect(reloaded).toBe(1);
        expect(JSON.stringify(fetched)).not.toContain(MARKER);
        stop();
        let cleared = false;
        const again = [];
        startOfflineRetry({
            location: { pathname: '/hangout/missing' },
            navigator: { onLine: true },
            fetch: async () => ({ body: { cancel: async () => {} } }),
            addEventListener() {},
            setTimeout(fn) { again.push(fn); return 1; },
            clearTimeout() { cleared = true; throw new TypeError('Illegal invocation'); },
            reload() { reloaded += 1; },
            setStatus() {}
        });
        await again[0]();
        expect(cleared).toBe(true);
        expect(reloaded).toBe(2);
    });

    it('stays on the offline page while the probe fails and does not loop on the offline document', async () => {
        const status = [];
        const fetched = [];
        let reloaded = 0;
        const timers = [];
        startOfflineRetry({
            location: { pathname: '/hangout/missing' },
            navigator: { onLine: false },
            fetch: async (url) => { fetched.push(url); throw new Error('offline'); },
            addEventListener() {},
            setTimeout(fn) { timers.push(fn); return timers.length; },
            clearTimeout() {},
            reload() { reloaded += 1; },
            setStatus(text) { status.push(text); }
        });
        await timers[0]();
        expect(fetched).toEqual(['/hangout/missing']);
        expect(reloaded).toBe(0);
        expect(status.at(-1)).toBe(RECONNECT_COPY);
        expect(shouldReconnect('/hangout/offline.html')).toBe(false);
        expect(probeUrl('/join/?invite=1')).toBe('/');
        const direct = [];
        startOfflineRetry({
            location: { pathname: '/hangout/offline.html' },
            navigator: { onLine: true },
            fetch: async () => { direct.push('fetched'); return {}; },
            addEventListener() {},
            setTimeout() { return 1; },
            clearTimeout() {},
            reload() { reloaded += 1; },
            setStatus(text) { status.push(text); }
        });
        expect(direct).toEqual([]);
        expect(reloaded).toBe(0);
        expect(status.at(-1)).toBe(RECONNECT_COPY);
    });
});

describe('icon shortcuts and last room', () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'manifest.json'), 'utf8'));

    it('lists Game Night, WebJam, and Last room without a token in the manifest', () => {
        expect(manifest.shortcuts.map((item) => item.name)).toEqual(['Game Night', 'WebJam', 'Last room']);
        const manifestUrl = new URL('https://stalemate.band/manifest.json');
        const scope = new URL(manifest.scope, manifestUrl).href;
        for (const shortcut of manifest.shortcuts) {
            const url = new URL(shortcut.url, manifestUrl);
            expect(url.href.startsWith(scope)).toBe(true);
            expect(url.hash).toBe('');
            expect(url.search).not.toMatch(/invite|grant|token|preview/i);
            expect(JSON.stringify(shortcut)).not.toContain('45662413410ed051');
        }
        expect(manifest.shortcuts[2].url).toBe('hangout/?go=last');
        const icons = manifest.shortcuts.map((item) => item.icons[0].src);
        expect(new Set(icons).size).toBe(3);
        const buffers = icons.map((src) => readFileSync(join(repoRoot, src)));
        expect(buffers[0].equals(buffers[1])).toBe(false);
        expect(buffers[1].equals(buffers[2])).toBe(false);
        expect(buffers[0].equals(buffers[2])).toBe(false);
        for (const buffer of buffers) {
            expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
            expect(buffer.readUInt32BE(16)).toBe(192);
            expect(buffer.readUInt32BE(20)).toBe(192);
        }
    });

    it('stores only a place name and opens that choice', async () => {
        const storage = memoryStorage();
        expect(rememberPlace(storage, 'webjam')).toBe(true);
        expect(rememberPlace(storage, `../join/?invite=${MARKER}`)).toBe(false);
        expect(readPlace(storage)).toBe('webjam');
        expect(readPlace(memoryStorage({ [LAST_ROOM_KEY]: MARKER }))).toBe('');
        expect(placeFromShortcut(`?go=last&invite=${MARKER}`, storage)).toBe('webjam');
        expect(placeFromShortcut('?go=game-night', storage)).toBe('game-night');
        expect(placeFromShortcut('?go=last', memoryStorage())).toBe('');
        expect(safeChoiceHref('../join/')).toBe(true);
        expect(safeChoiceHref('../r/45662413410ed051/lobby/?game-night=1')).toBe(true);
        expect(safeChoiceHref(`../join/?invite=${MARKER}`)).toBe(false);
        expect(safeChoiceHref('javascript:alert(1)')).toBe(false);
        expect(safeChoiceHref('https://evil.example/join/')).toBe(false);
        const doc = page('', [
            '<a data-place="hangout" href="../r/45662413410ed051/">Hang Out</a>',
            '<a data-place="game-night" href="../r/45662413410ed051/lobby/?game-night=1">Game Night</a>',
            '<a data-place="webjam" href="../join/">WebJam</a>'
        ].join(''));
        const replaced = [];
        const asked = [];
        expect(mountShortcuts(doc, {
            search: `?go=last&invite=${MARKER}`,
            storage,
            replace: (href) => replaced.push(href),
            onWebjam: () => asked.push('ask')
        })).toBe(false);
        expect(replaced).toEqual([]);
        expect(asked).toEqual([]);
        expect(readPlace(storage)).toBe('webjam');
        expect(choiceHref(doc, 'game-night')).toBe('../r/45662413410ed051/lobby/?game-night=1');
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        doc.querySelector('[data-place="webjam"]').dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(asked).toEqual(['ask']);
        const fresh = memoryStorage();
        mountShortcuts(doc, { search: '', storage: fresh, replace: () => {} });
        doc.querySelector('[data-place="game-night"]').click();
        expect(readPlace(fresh)).toBe('game-night');
        const secret = 'a'.repeat(24);
        const host = 'b'.repeat(80);
        expect(classifyInvite('', `#r=${secret}&h=${host}`)).toBe('valid');
        expect(classifyInvite('', `#r=${MARKER}&h=${MARKER}`)).toBe('invalid');
        expect(classifyInvite('', '')).toBe('absent');
        const bytes = new Uint8Array(32);
        bytes[0] = 1;
        let binary = '';
        bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
        const capability = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
        const session = 'ab'.repeat(32);
        const expires = Math.floor(Date.now() / 1000) + 120;
        const webjam = `#k=${capability}&s=${session}&g=1&e=${expires}`;
        expect(classifyInvite('', webjam, Date.now())).toBe('valid');
        expect(classifyInvite('', `#k=${'A'.repeat(43)}&s=${session}&g=1&e=${expires}`)).toBe('invalid');
        expect(inviteSignal('', webjam)).toBe(true);
        const validDoc = page(
            '<meta name="hangout-open-in-app" content="invite"><meta name="hangout-place" content="hangout">',
            '<section data-gate><input data-name><button data-enter type="button">Jump in</button></section>'
        );
        expect(await mountOpenInApp(validDoc, {
            userAgent: ANDROID,
            storage: memoryStorage(),
            matchMedia: () => ({ matches: false }),
            navigatorStandalone: false,
            installed: 'unknown',
            search: '',
            hash: `#r=${secret}&h=${host}`,
            homeHref: '/hangout/'
        })).toBe(true);
        const guide = validDoc.querySelector('[data-open-in-app]');
        expect(guide.querySelector('button').textContent).toBe(JUMP_LABEL);
        expect(validDoc.querySelector('[data-enter]').hidden).toBe(true);
        expect(validDoc.querySelectorAll('button:not([hidden])')).toHaveLength(1);
        expect(guide.textContent).not.toContain(secret);
        expect(guide.textContent).not.toContain(host);
        expect(guide.querySelectorAll('p')).toHaveLength(0);
        const name = validDoc.querySelector('[data-name]');
        let focused = 0;
        name.focus = () => { focused += 1; };
        guide.querySelector('button').click();
        expect(focused).toBe(1);
        expect(jumpIn(validDoc)).toBe('name');
        name.value = 'Ada';
        let clicked = 0;
        validDoc.querySelector('[data-enter]').addEventListener('click', () => { clicked += 1; });
        expect(jumpIn(validDoc)).toBe('enter');
        expect(clicked).toBe(1);
        const slot = document.createElement('div');
        slot.hidden = true;
        expect(mountHostAsk(slot, { userAgent: IPHONE, maxTouchPoints: 0, homeHref: '/hangout/' })).toBe(true);
        expect(slot.hidden).toBe(false);
        expect(slot.textContent).toContain(HOST_ASK);
        expect(slot.textContent).not.toContain(IPHONE_LIMIT);
        expect(slot.textContent).not.toContain('Safari');
        expect(slot.textContent).not.toContain(secret);
        const quiet = readFileSync(join(repoRoot, 'hangout/open-in-app.css'), 'utf8');
        expect(quiet).toMatch(/\.hoa__quiet\s*\{[^}]*min-height:\s*44px/s);
        const ask = slot.querySelector('[data-open-in-app]');
        expect(ask.firstElementChild.textContent).toBe(HOST_ASK);
        expect(ask.querySelector('a')).toBeNull();
        expect(ask.querySelector('.hoa__go')).toBeNull();
        const entry = readFileSync(join(repoRoot, 'hangout/index.html'), 'utf8');
        expect(entry).toContain(HOST_ASK);
        expect(entry).toContain('href="../join/"');
        expect(entry).toContain('href="door.html?kind=hangout"');
        expect(entry).toContain('href="door.html?kind=game-night&amp;game-night=1"');
        expect(entry).toContain('data-last-empty');
        expect(entry).not.toContain('45662413410ed051');
    });

    it('does not log or cache an invite from the worker', () => {
        const source = readFileSync(join(repoRoot, 'sw.js'), 'utf8');
        const handler = source.slice(source.indexOf("addEventListener('fetch'"));
        expect(handler.indexOf('isSensitiveRequest')).toBeGreaterThan(-1);
        expect(handler.indexOf('isSensitiveRequest')).toBeLessThan(handler.indexOf('isJoinNavigation'));
        expect(source).not.toContain('cache.put');
        expect(source).not.toContain('cache.addAll');
        expect(source).not.toContain('console.');
        expect(source).not.toContain(MARKER);
        expect(handler.indexOf('isJoinNavigation')).toBeLessThan(handler.indexOf('isLobbyNavigation'));
    });
});

describe('home screen doors', () => {
    function doorDoc() {
        return page('', [
            '<p data-door-kicker></p>',
            '<h1 data-door-title>Hang Out</h1>',
            '<p data-door-step></p>',
            '<p data-door-meta hidden></p>',
            '<input data-name>',
            '<button data-enter type="button">Jump in</button>',
            '<p data-door-status role="status"></p>',
            '<a data-door-home href="./">Hang Out home</a>'
        ].join(''));
    }

    it('opens a different page for drawing, watching, and a game, and keeps the name field', () => {
        expect(placeHref('hangout')).toBe('door.html?kind=hangout');
        expect(placeHref('game-night')).toBe('door.html?kind=game-night&game-night=1');
        expect(parseDoor('?kind=watch&title=Watch+party').heading).toBe('Watch party');
        expect(parseDoor('?kind=watch&title=Watch+party').step).toBe('Pick a name and watch together.');
        const draw = doorDoc();
        const storage = memoryStorage();
        mountDoor(draw, { search: '?kind=draw&title=Drawing+room&count=2&via=art', storage });
        expect(draw.querySelector('h1').textContent).toBe('Drawing room');
        expect(draw.querySelector('[data-door-step]').textContent).toBe('Pick a name and draw together.');
        expect(draw.querySelector('[data-door-meta]').hidden).toBe(false);
        expect(draw.querySelector('[data-door-meta]').textContent).toBe('2 here · Draw together');
        expect(draw.querySelector('[data-name]').hidden).toBe(false);
        expect(draw.querySelector('[data-enter]').hidden).toBe(false);
        draw.querySelector('[data-enter]').click();
        expect(draw.querySelector('[data-door-status]').textContent).toBe('Type a name to jump in.');
        draw.querySelector('[data-name]').value = 'Ada';
        draw.querySelector('[data-enter]').click();
        expect(draw.querySelector('[data-name]').hidden).toBe(false);
        expect(draw.querySelector('[data-enter]').hidden).toBe(false);
        expect(draw.querySelector('[data-door-status]').textContent).toBe(cannotOpenLine('Drawing room'));
        expect(draw.querySelector('[data-door-status]').textContent).not.toContain('\n');
        expect(draw.body.textContent).not.toContain('Name saved on this device.');
        expect(draw.querySelector('[data-door-home]').textContent).toBe('Hang Out home');
        expect(storage.getItem('hangout-nick')).toBe('Ada');
        const html = readFileSync(join(repoRoot, 'hangout/door.html'), 'utf8');
        expect(html).toContain('data-name');
        expect(html).toContain('data-enter');
        expect(html).toContain('webjam-mark.svg');
        expect(html).toContain('Hang Out home');
        expect(html).toContain('data-door-meta');
        expect(html).not.toMatch(/<(?:input|button)\b[^>]*\bhidden\b/);
        expect(readFileSync(join(repoRoot, 'assets/hangout-app/webjam-mark.svg'), 'utf8')).toContain('#E87900');
    });

    it('puts game-night=1 back when the address bar is cleaned', () => {
        const location = {
            href: 'https://hangout.example/hangout/door.html?kind=game-night&title=Royal+Flush+Chess&count=2&via=game&game-night=1'
        };
        const history = {
            replaceState(state, title, url) {
                location.href = new URL(url, location.href).href;
            }
        };
        guardGameNightFlag(history, location);
        history.replaceState(null, '', '/hangout/door.html');
        expect(new URL(location.href).searchParams.get('game-night')).toBe('1');
        expect(new URL(location.href).searchParams.get('kind')).toBe('game-night');
        expect(new URL(location.href).searchParams.get('title')).toBe('Royal Flush Chess');
        expect(new URL(location.href).searchParams.get('count')).toBe('2');
        expect(new URL(location.href).searchParams.get('via')).toBe('game');
        history.replaceState(null, '', '/hangout/door.html?preview=no');
        expect(new URL(location.href).searchParams.has('preview')).toBe(false);
        expect(new URL(location.href).searchParams.get('game-night')).toBe('1');
        expect(retainDoorQuery(location.href, '/hangout/door.html')).toContain('game-night=1');
        const doc = doorDoc();
        const parsed = mountDoor(doc, {
            search: '?kind=game-night&game-night=1',
            storage: memoryStorage(),
            history,
            location
        });
        expect(parsed.heading).toBe('Game Night');
        expect(doc.querySelector('[data-name]').hidden).toBe(false);
        expect(doc.querySelector('[data-enter]').hidden).toBe(false);
    });

    it('says when Last room has nothing saved', () => {
        const doc = page('', '<p data-last-empty role="status" hidden></p><a data-place="hangout" href="door.html?kind=hangout">Hang Out</a>');
        const replaced = [];
        mountShortcuts(doc, {
            search: '?go=last',
            storage: memoryStorage(),
            replace: (href) => replaced.push(href),
            onEmptyLast: () => showEmptyLast(doc)
        });
        expect(replaced).toEqual([]);
        expect(doc.querySelector('[data-last-empty]').hidden).toBe(false);
        expect(doc.querySelector('[data-last-empty]').textContent).toBe(LAST_ROOM_EMPTY);
        expect(showEmptyLast(page('', ''))).toBe(false);
    });
});

describe('absent WebJam invite and lobby flag', () => {
    it('asks for the host link instead of calling a missing invite invalid', async () => {
        const doc = page('', '<p id="status">Open the invite link from your host.</p><p id="error-hint"></p><button id="retry">Retry</button>');
        expect(repairAbsentJoin(doc, { search: '', hash: '', homeHref: '/hangout/', ios: false })).toBe(true);
        expect(doc.body.firstElementChild.querySelector('.hoa__lead').textContent).toBe(HOST_ASK);
        expect(doc.querySelector('.hoa__go')).toBeNull();
        doc.getElementById('status').textContent = 'Invalid Web Join invite';
        doc.getElementById('status').dataset.failure = 'true';
        doc.getElementById('retry').hidden = false;
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(doc.getElementById('status').textContent).toBe(HOST_ASK);
        expect(doc.getElementById('status').hasAttribute('data-failure')).toBe(false);
        expect(doc.getElementById('retry').hidden).toBe(true);
        const kept = page('', '<p id="status">Your host invited you to join.</p>');
        expect(repairAbsentJoin(kept, { search: '', hash: '#k=not-valid', homeHref: '/hangout/' })).toBe(false);
        expect(kept.querySelector('[data-open-in-app]')).toBeNull();
        expect(kept.getElementById('status').textContent).toBe('Your host invited you to join.');
        const joinHtml = readFileSync(join(repoRoot, 'join/index.html'), 'utf8');
        expect(joinHtml.indexOf('join-absent.mjs')).toBeLessThan(joinHtml.indexOf('src="app.js"'));
        expect(joinHtml).toContain(HOST_ASK);
    });

    it('keeps the game-night flag on a lobby navigation and shows the name field', () => {
        const current = 'https://hangout.example/community/lobby/?game-night=1';
        expect(isLobbyNavigation(current)).toBe(true);
        expect(isLobbyNavigation('https://hangout.example/join/')).toBe(false);
        expect(retainLobbyGameNight(current, '/community/lobby/')).toBe('/community/lobby/?game-night=1');
        expect(retainLobbyGameNight(current, '/community/lobby/?preview=no')).not.toContain('preview');
        expect(retainLobbyGameNight(current, '/community/lobby/?preview=no')).toContain('game-night=1');
        const doc = page('', [
            '<h1>#stalemate</h1>',
            '<p data-gate-copy>Not open yet. The band is still building this one.</p>',
            '<label class="nickrow" hidden>Your nick <input data-nick></label>',
            '<button data-enter type="button" hidden disabled>Enter</button>'
        ].join(''));
        expect(revealClosedDoor(doc, { gameNight: true })).toBe(true);
        expect(doc.querySelector('h1').textContent).toBe('Game Night');
        expect(doc.querySelector('[data-gate-copy]').textContent).toBe('Pick a name and jump in.');
        expect(doc.querySelector('.nickrow').hidden).toBe(false);
        expect(doc.querySelector('[data-enter]').hidden).toBe(false);
        expect(doc.querySelector('[data-enter]').disabled).toBe(false);
        const html = '<!doctype html><html><head><title>Lobby</title></head><body><p>Gate</p></body></html>';
        const next = injectLobbyDoor(html, 'https://hangout.example/hangout/', 'https://hangout.example/community/lobby/?game-night=1');
        expect(next).toContain('src="https://hangout.example/hangout/lobby-door.mjs"');
        expect(next).toContain('name="hangout-lobby-door"');
        expect(injectLobbyDoor(next, 'https://hangout.example/hangout/', 'https://hangout.example/community/lobby/')).toBe(next);
        expect(injectLobbyDoor(html, 'https://evil.example/hangout/', 'https://hangout.example/community/lobby/')).toBe(html);
    });
});
