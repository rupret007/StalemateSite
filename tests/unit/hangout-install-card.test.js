import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    ANDROID_HINT,
    DESKTOP_HINT,
    DISMISS_KEY,
    INSTALLED_KEY,
    SHARE_HINT,
    fillInstallCard,
    installCardState,
    isAndroidInstallBrowser,
    isIos,
    mountInstallCard,
    readFlag,
    standaloneFrom,
    writeFlag
} from '../../hangout/install-card.mjs';
import { homeScreenWorkerTarget } from '../../hangout/register-sw.mjs';
import { isSensitiveRequest } from '../../hangout/sw-policy.mjs';

const repoRoot = process.cwd();
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function pngSize(buffer) {
    expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function memoryStorage(initial = {}) {
    const data = new Map(Object.entries(initial));
    return {
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => { data.set(key, String(value)); }
    };
}

function mount(root, overrides = {}) {
    const handlers = {};
    mountInstallCard(root, {
        userAgent: IPHONE,
        maxTouchPoints: 0,
        storage: memoryStorage(),
        matchMedia: () => ({ matches: false }),
        navigatorStandalone: false,
        listen(type, handler) { handlers[type] = handler; },
        ...overrides
    });
    return handlers;
}

describe('install card state', () => {
    it('shows the iPhone share hint and hides Install', () => {
        const state = installCardState({ userAgent: IPHONE });
        expect(state).toEqual({ visible: true, variant: 'ios', installEnabled: false });
        expect(isIos(IPHONE)).toBe(true);
        expect(isAndroidInstallBrowser(IPHONE)).toBe(false);
        const root = document.createElement('aside');
        fillInstallCard(root, state);
        expect(root.hidden).toBe(false);
        expect(root.dataset.variant).toBe('ios');
        expect(root.textContent).toContain(SHARE_HINT);
        expect(root.textContent).toContain('Share');
        expect(root.textContent).toContain('Add to Home Screen');
        expect(root.querySelector('.install__go')).toBeNull();
        expect(root.querySelectorAll('svg')).toHaveLength(2);
        expect([...root.querySelectorAll('.install__steps li')].map((item) => item.textContent)).toEqual([
            'Share',
            'Add to Home Screen'
        ]);
    });

    it('treats iPadOS desktop Safari as iPhone-style instructions', () => {
        const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
        expect(isIos(ua, 5)).toBe(true);
        expect(installCardState({ userAgent: ua, maxTouchPoints: 5 }).variant).toBe('ios');
        expect(installCardState({ userAgent: ua, maxTouchPoints: 0 }).variant).toBe('desktop');
        expect(installCardState({ userAgent: DESKTOP, maxTouchPoints: 5 }).variant).toBe('desktop');
    });

    it('keeps an iPhone on the share hint even if a prompt object exists', () => {
        expect(installCardState({ userAgent: IPHONE, deferredPrompt: {} }).variant).toBe('ios');
    });

    it('shows Android menu steps until the browser offers Install', () => {
        const state = installCardState({ userAgent: ANDROID });
        expect(state).toEqual({ visible: true, variant: 'android', installEnabled: false });
        const root = document.createElement('aside');
        fillInstallCard(root, state);
        expect(root.querySelector('.install__go')).toBeNull();
        expect(root.textContent).toContain(ANDROID_HINT);
        expect(root.textContent).toContain('Install app');
        expect([...root.querySelectorAll('.install__steps li')].map((item) => item.textContent)).toEqual([
            '⋮',
            'Add to Home screen'
        ]);
        expect(root.querySelectorAll('svg')).toHaveLength(2);
        expect(root.textContent).not.toContain(SHARE_HINT);
    });

    it('enables Install when a deferred prompt is waiting', () => {
        expect(installCardState({ userAgent: ANDROID, deferredPrompt: {} }).installEnabled).toBe(true);
        expect(installCardState({ userAgent: DESKTOP, deferredPrompt: {} })).toEqual({
            visible: true, variant: 'install', installEnabled: true
        });
    });

    it('shows a short desktop install hint until Chrome offers install', () => {
        const state = installCardState({ userAgent: DESKTOP });
        expect(state).toEqual({ visible: true, variant: 'desktop', installEnabled: false });
        const root = document.createElement('aside');
        fillInstallCard(root, state);
        expect(root.hidden).toBe(false);
        expect(root.textContent).toContain(DESKTOP_HINT);
        expect(root.querySelector('.install__go')).toBeNull();
        expect(root.textContent).not.toContain(SHARE_HINT);
    });

    it('hides the card when the app is already installed or the hint was dismissed', () => {
        expect(installCardState({ userAgent: IPHONE, standalone: true }).visible).toBe(false);
        expect(installCardState({ userAgent: ANDROID, dismissed: true, deferredPrompt: {} }).visible).toBe(false);
        expect(standaloneFrom({ navigatorStandalone: true })).toBe(true);
        expect(standaloneFrom({ matchMedia: (query) => ({ matches: query.includes('fullscreen') }) })).toBe(true);
        expect(standaloneFrom({ matchMedia: () => { throw new Error('blocked'); } })).toBe(false);
        expect(standaloneFrom({})).toBe(false);
    });
});

describe('install card behavior', () => {
    it('remembers dismiss and stays hidden on the next visit', () => {
        const storage = memoryStorage();
        const root = document.createElement('aside');
        mount(root, { storage });
        expect(root.hidden).toBe(false);
        root.querySelector('.install__dismiss').click();
        expect(root.hidden).toBe(true);
        expect(readFlag(storage, DISMISS_KEY)).toBe(true);

        const again = document.createElement('aside');
        mount(again, { storage });
        expect(again.hidden).toBe(true);
    });

    it('still hides for this visit when storage throws', () => {
        const storage = {
            getItem() { throw new Error('blocked'); },
            setItem() { throw new Error('blocked'); }
        };
        const root = document.createElement('aside');
        expect(() => mount(root, { storage })).not.toThrow();
        expect(root.hidden).toBe(false);
        expect(() => root.querySelector('.install__dismiss').click()).not.toThrow();
        expect(root.hidden).toBe(true);
        expect(writeFlag(storage, DISMISS_KEY)).toBe(false);
        expect(readFlag(storage, DISMISS_KEY)).toBe(false);
    });

    it('calls the browser prompt once and hides after the person accepts', async () => {
        const storage = memoryStorage();
        const root = document.createElement('aside');
        const handlers = mount(root, { userAgent: ANDROID, storage });
        expect(root.querySelector('.install__go')).toBeNull();
        expect(root.textContent).toContain('⋮');

        let prompts = 0;
        const event = new Event('beforeinstallprompt', { cancelable: true });
        event.prompt = () => {
            prompts += 1;
            return Promise.resolve();
        };
        event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
        handlers.beforeinstallprompt(event);

        expect(event.defaultPrevented).toBe(true);
        expect(root.querySelector('.install__go').disabled).toBe(false);
        root.querySelector('.install__go').click();
        root.querySelector('.install__go').click();
        for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
        expect(prompts).toBe(1);
        expect(readFlag(storage, INSTALLED_KEY)).toBe(true);
        expect(root.hidden).toBe(true);
    });

    it('drops a dismissed prompt without marking the app installed', async () => {
        const storage = memoryStorage();
        const root = document.createElement('aside');
        const handlers = mount(root, { userAgent: ANDROID, storage });
        const event = new Event('beforeinstallprompt', { cancelable: true });
        event.prompt = () => Promise.resolve();
        event.userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'web' });
        handlers.beforeinstallprompt(event);
        root.querySelector('.install__go').click();
        for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
        expect(readFlag(storage, INSTALLED_KEY)).toBe(false);
        expect(root.hidden).toBe(false);
        expect(root.querySelector('.install__go')).toBeNull();
        expect(root.textContent).toContain(ANDROID_HINT);
    });

    it('hides when the browser reports the app was installed', () => {
        const storage = memoryStorage();
        const root = document.createElement('aside');
        const handlers = mount(root, { userAgent: DESKTOP, storage });
        expect(root.hidden).toBe(false);
        expect(root.textContent).toContain(DESKTOP_HINT);
        handlers.appinstalled();
        expect(readFlag(storage, INSTALLED_KEY)).toBe(true);
        expect(root.hidden).toBe(true);
    });
});

describe('home screen worker policy', () => {
    const sensitive = [
        'https://hangout.example/beta/state',
        'https://hangout.example/beta/unlock',
        'https://hangout.example/beta/game-night/invitation/issue',
        'https://hangout.example/StalemateSite/beta/participation/grant',
        'https://hangout.example/join/?invite=1',
        'https://hangout.example/hangout/?grant=1',
        'https://stalemate-hangout.jeffstory007.workers.dev/room',
        'https://hangout.example/api/health',
        'https://hangout.example/hangout-worker/src/index.mjs'
    ];

    it('refuses API, Worker, invite, and grant requests', () => {
        for (const href of sensitive) {
            expect(isSensitiveRequest(href), href).toBe(true);
        }
        expect(isSensitiveRequest('https://hangout.example/hangout/', { method: 'POST' })).toBe(true);
        expect(isSensitiveRequest('https://hangout.example/hangout/boot.mjs', { destination: 'worker' })).toBe(true);
        expect(isSensitiveRequest('not a url')).toBe(true);
    });

    it('leaves ordinary pages and icons alone', () => {
        for (const href of [
            'https://hangout.example/hangout/',
            'https://hangout.example/hangout/offline.html',
            'https://hangout.example/join/',
            'https://hangout.example/assets/hangout-app/icon-192.png',
            'https://hangout.example/sw.js',
            'https://hangout.example/manifest.json'
        ]) {
            expect(isSensitiveRequest(href), href).toBe(false);
        }
    });

    it('does not store responses except the precached offline page', () => {
        const source = readFileSync(join(repoRoot, 'sw.js'), 'utf8');
        expect(source).toContain('isSensitiveRequest');
        expect(source).not.toContain('cache.put');
        expect(source).not.toContain('cache.addAll');
        expect(source).toContain('offlineUrl');
    });

    it('registers the worker at the site root for both hosting prefixes', () => {
        expect(homeScreenWorkerTarget('http://127.0.0.1:4320/hangout/boot.mjs')).toEqual({
            script: 'http://127.0.0.1:4320/sw.js',
            scope: '/',
            type: 'module'
        });
        expect(homeScreenWorkerTarget('https://jeffstory.github.io/StalemateSite/hangout/boot.mjs')).toEqual({
            script: 'https://jeffstory.github.io/StalemateSite/sw.js',
            scope: '/StalemateSite/',
            type: 'module'
        });
    });
});

describe('home screen manifest and icons', () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'manifest.json'), 'utf8'));

    it('names Hang Out and opens the entry page standalone in the site colors', () => {
        expect(manifest.name).toBe('Hang Out');
        expect(manifest.short_name).toBe('Hang Out');
        expect(manifest.start_url).toBe('hangout/');
        expect(manifest.scope).toBe('./');
        expect(manifest.display).toBe('standalone');
        expect(manifest.theme_color).toBe('#171410');
        expect(manifest.background_color).toBe('#171410');
        const manifestUrl = new URL('https://stalemate.band/manifest.json');
        expect(new URL(manifest.start_url, manifestUrl).pathname).toBe('/hangout/');
        expect(new URL(manifest.scope, manifestUrl).pathname).toBe('/');
    });

    it('ships 180, 192, 512, and maskable icons from the copied trefoil', () => {
        const expected = {
            'assets/hangout-app/apple-touch-icon.png': 180,
            'assets/hangout-app/icon-192.png': 192,
            'assets/hangout-app/icon-512.png': 512,
            'assets/hangout-app/icon-maskable-192.png': 192,
            'assets/hangout-app/icon-maskable-512.png': 512
        };
        for (const [file, size] of Object.entries(expected)) {
            expect(pngSize(readFileSync(join(repoRoot, file)))).toEqual({ width: size, height: size });
        }
        const purposes = manifest.icons.map((icon) => `${icon.sizes}:${icon.purpose}`);
        expect(purposes).toEqual(expect.arrayContaining([
            '192x192:any', '512x512:any', '180x180:any', '192x192:maskable', '512x512:maskable'
        ]));
        const svg = readFileSync(join(repoRoot, 'assets/hangout-app/webjam-mark.svg'), 'utf8');
        expect(svg).toContain('M32.00 24.43');
        expect(svg).toContain('#E87900');
        const brand = join(repoRoot, '../hangout-homescreen-brand');
        for (const name of ['webjam-mark.svg', 'AppIcon-1024.png', 'icon_512x512.png']) {
            const copied = readFileSync(join(repoRoot, 'assets/hangout-app', name));
            if (existsSync(join(brand, name))) {
                expect(copied.equals(readFileSync(join(brand, name))), name).toBe(true);
            }
        }
    });

    it('points the entry page at the manifest, the touch icon, and the three existing pages', () => {
        const html = readFileSync(join(repoRoot, 'hangout/index.html'), 'utf8');
        expect(html).toContain('rel="manifest" href="../manifest.json"');
        expect(html).toContain('rel="apple-touch-icon"');
        expect(html).toContain('content="#171410"');
        expect(html).toContain('content="Hang Out"');
        expect(html).not.toMatch(/data-hangout|hang ?out room/i);
        expect(html).toContain('href="../join/"');
    });
});
