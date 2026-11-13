import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { injectJoinGuide, isJoinNavigation, shouldGuideJoin } from '../../hangout/join-guide.mjs';
import {
    LAST_ROOM_KEY,
    choiceHref,
    mountShortcuts,
    placeFromShortcut,
    readPlace,
    rememberPlace,
    safeChoiceHref
} from '../../hangout/last-room.mjs';
import {
    RECONNECT_COPY,
    probeUrl,
    shouldReconnect,
    startOfflineRetry
} from '../../hangout/offline-retry.mjs';
import {
    OPEN_IN_APP_TITLE,
    detectInstalled,
    fillOpenInApp,
    inviteSignal,
    mountOpenInApp,
    openInAppCopy,
    openInAppDecision
} from '../../hangout/open-in-app.mjs';
import { isOfflineAsset, offlineAssetUrls, offlineDocument } from '../../hangout/sw-policy.mjs';
import {
    EMPTY_COPY,
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

    it('states the iPhone limit and offers Open in Hang Out when installation is unknown', () => {
        expect(openInAppDecision({ installed: 'unknown' })).toEqual({ show: true, installed: 'unknown' });
        expect(openInAppDecision({ standalone: true, installed: 'unknown' }).show).toBe(false);
        expect(openInAppDecision({ inviteOnly: true, invitePresent: false }).show).toBe(false);
        expect(openInAppDecision({ inviteOnly: true, invitePresent: true, installed: 'unknown' }).show).toBe(true);
        const ios = openInAppCopy({ ios: true, installed: 'unknown' });
        expect(ios).toMatch(/Safari/);
        expect(ios).toMatch(/cannot take this link/);
        expect(ios).not.toMatch(/opens in the (app|Hang Out icon)/);
        expect(openInAppCopy({ installed: 'unknown' })).toMatch(/cannot tell whether the app is installed/);
        const region = fillOpenInApp(document, { ios: true, installed: 'unknown' });
        expect(region.querySelector('h2').textContent).toBe(OPEN_IN_APP_TITLE);
        expect(region.textContent).toContain(ios);
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
            hash: `#r=${MARKER}&h=${MARKER}`
        });
        expect(shown).toBe(true);
        expect(doc.body.textContent).toContain(OPEN_IN_APP_TITLE);
        expect(doc.body.textContent).toContain('Safari');
        expect(doc.body.textContent).not.toContain(MARKER);
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
        renderPlaces(root, places, {
            lobby: '../r/45662413410ed051/lobby/',
            game: '../r/45662413410ed051/lobby/?game-night=1',
            jam: '../join/'
        }, safeChoiceHref);
        expect(root.textContent).toContain('Drawing room');
        expect(root.textContent).toContain('2 here · Draw together');
        expect(root.textContent).toContain('Royal Flush Chess');
        expect(root.textContent).not.toContain('SecretNick');
        expect(root.textContent).not.toContain(MARKER);
        expect(root.textContent).not.toContain('#game-');
        expect(root.textContent).not.toContain('hidden@example.test');
        expect(root.querySelectorAll('a')).toHaveLength(2);
        expect(root.querySelector('a').getAttribute('href')).toBe('../r/45662413410ed051/lobby/');
        expect(root.querySelectorAll('a')[1].getAttribute('href')).toBe('../r/45662413410ed051/lobby/?game-night=1');
        renderPlaces(root, [], { lobby: '', game: '', jam: '' }, safeChoiceHref);
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
    });

    it('stores only a place name and opens that choice', () => {
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
        expect(mountShortcuts(doc, {
            search: `?go=last&invite=${MARKER}`,
            storage,
            replace: (href) => replaced.push(href)
        })).toBe(true);
        expect(replaced).toEqual(['../join/']);
        expect(replaced.join('')).not.toContain(MARKER);
        expect(choiceHref(doc, 'game-night')).toBe('../r/45662413410ed051/lobby/?game-night=1');
        const fresh = memoryStorage();
        mountShortcuts(doc, { search: '', storage: fresh, replace: () => {} });
        doc.querySelector('[data-place="game-night"]').click();
        expect(readPlace(fresh)).toBe('game-night');
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
    });
});
