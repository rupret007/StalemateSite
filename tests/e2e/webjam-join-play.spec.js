const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test, expect } = require('@playwright/test');

async function routeProtectedListen(page, baseURL, sessionSource) {
    const origin = new URL(baseURL).origin;
    const external = [];
    await page.route('**/*', route => {
        const address = new URL(route.request().url());
        if (address.origin !== origin) {
            external.push(address.origin);
            return route.abort();
        }
        if (address.pathname === '/join/') {
            return route.fulfill({ path: resolve(__dirname, '../../hangout-worker/web-join-chess/index.html'), contentType: 'text/html' });
        }
        if (address.pathname === '/join/app.js') {
            return route.fulfill({ path: resolve(__dirname, '../../hangout-worker/web-join-music/app.js'), contentType: 'text/javascript' });
        }
        if (address.pathname === '/join/style.css') {
            const baseStyle = readFileSync(resolve(__dirname, '../../join/style.css'), 'utf8');
            const privateStyle = readFileSync(resolve(__dirname, '../../hangout-worker/web-join-music/style.css'), 'utf8');
            return route.fulfill({ contentType: 'text/css', body: `${baseStyle}\n${privateStyle}` });
        }
        if (address.pathname === '/join/session.js') {
            return route.fulfill({ contentType: 'text/javascript', body: sessionSource });
        }
        return route.continue();
    });
    return external;
}

for (const [width, height] of [[375, 667], [390, 844], [1440, 900]]) {
    test(`private Web Join audio controls have usable tap targets at ${width}px`, async ({ page, baseURL }, testInfo) => {
        await page.setViewportSize({ width, height });
        const external = await routeProtectedListen(page, baseURL, `
            export class WebJoinSession {
                constructor(options) { this.options = options; }
                async join() { this.options.onStatus('Connected'); }
                close() {}
            }`);
        const capability = Buffer.alloc(32, 17).toString('base64url');
        const expires = Math.floor(Date.now() / 1000) + 300;
        await page.goto(`/join/#k=${capability}&s=${'22'.repeat(32)}&g=1&e=${expires}`);
        const listen = page.getByRole('button', { name: 'Join to listen', exact: true });
        const leave = page.getByRole('button', { name: 'Leave session', exact: true });
        const details = page.getByText('Audio details', { exact: true });
        const check = page.getByRole('button', { name: 'Check microphone', exact: true });
        const skip = page.getByRole('button', { name: 'Skip check', exact: true });
        const headphones = page.locator('label.headphones');
        const join = page.getByRole('button', { name: 'Join with microphone', exact: true });
        for (const control of [listen, details, check, skip, headphones, join]) {
            await expect(control).toBeVisible();
            const { width, height } = await control.boundingBox();
            expect(width).toBeGreaterThanOrEqual(48);
            expect(height).toBeGreaterThanOrEqual(48);
        }
        await join.scrollIntoViewIfNeeded();
        await expect(join).toBeInViewport({ ratio: 1 });
        await page.screenshot({ path: testInfo.outputPath('prejoin-tap-targets.png') });
        await listen.click();
        await expect(leave).toBeInViewport({ ratio: 1 });
        const bounds = await leave.boundingBox();
        expect(bounds.width).toBeGreaterThanOrEqual(48);
        expect(bounds.height).toBeGreaterThanOrEqual(48);
        await details.click();
        await expect(page.locator('details')).toHaveAttribute('open', '');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath('connected-tap-targets.png') });
        await leave.click();
        await expect(listen).toBeVisible();
        expect(external).toEqual([]);
    });
}

for (const [width, height] of [[375, 667], [390, 844], [1440, 900]]) {
    test(`a guest can recheck after Skip check and recover permission denial at ${width}px`, async ({ page, baseURL }, testInfo) => {
        await page.setViewportSize({ width, height });
        const external = await routeProtectedListen(page, baseURL, `
            export class WebJoinSession {
                constructor(options) { this.options = options; }
                async join() { window.joinAttempts++; this.options.onStatus('Synthetic audio session connected.'); }
                close() { this.options.stream.getTracks().forEach(track => track.stop()); }
            }`);
        await page.addInitScript(() => {
            window.captureCalls = 0; window.joinAttempts = 0; window.captureTracks = []; window.audioContexts = [];
            const NativeContext = window.AudioContext;
            window.AudioContext = class extends NativeContext {
                constructor(...args) { super(...args); window.audioContexts.push(this); }
            };
            const media = Object.getPrototypeOf(navigator.mediaDevices);
            media.enumerateDevices = async () => [];
            media.getUserMedia = async () => {
                window.captureCalls++;
                if (window.captureCalls === 1) throw new DOMException('Synthetic permission denial', 'NotAllowedError');
                const context = new AudioContext();
                const output = context.createMediaStreamDestination();
                const tone = context.createOscillator(), gain = context.createGain();
                gain.gain.value = 0.08;
                tone.connect(gain).connect(output); tone.start();
                await context.resume();
                for (const track of output.stream.getTracks()) {
                    const stop = track.stop.bind(track);
                    track.stop = () => { stop(); context.close().catch(() => {}); };
                    window.captureTracks.push(track);
                }
                return output.stream;
            };
        });
        const capability = Buffer.alloc(32, 17).toString('base64url');
        const expires = Math.floor(Date.now() / 1000) + 300;
        await page.goto(`/join/#k=${capability}&s=${'22'.repeat(32)}&g=1&e=${expires}`);
        const join = page.getByRole('button', { name: 'Join with microphone', exact: true });
        const check = page.getByRole('button', { name: 'Check microphone', exact: true });
        await page.getByRole('checkbox').check();
        await page.getByRole('button', { name: 'Skip check', exact: true }).press('Enter');
        await expect(join).toBeEnabled();
        expect(await page.evaluate(() => ({ captures: captureCalls, joins: joinAttempts, contexts: audioContexts.length })))
            .toEqual({ captures: 0, joins: 0, contexts: 0 });
        await check.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`skipped-before-recheck-${width}.png`) });
        await expect(check).toBeEnabled();
        await check.press('Enter');
        await expect(page.locator('#mic-error')).toContainText('Microphone access was blocked');
        await expect(join).toBeDisabled();
        await expect(page.locator('#mic-heard')).toBeHidden();
        const retry = page.getByRole('button', { name: 'Try again', exact: true });
        await expect(retry).toBeFocused();
        expect(await page.evaluate(() => ({ captures: captureCalls, joins: joinAttempts }))).toEqual({ captures: 1, joins: 0 });
        await page.screenshot({ path: testInfo.outputPath(`recheck-permission-denied-${width}.png`) });
        await retry.press('Enter');
        await expect(page.getByText('Microphone detected.', { exact: true })).toBeVisible();
        await expect(join).toBeEnabled(); await expect(join).toBeFocused();
        expect(await page.evaluate(() => ({ captures: captureCalls, joins: joinAttempts }))).toEqual({ captures: 2, joins: 0 });
        await page.screenshot({ path: testInfo.outputPath(`recheck-ready-${width}.png`) });
        await join.press('Enter');
        await expect(page.locator('#status')).toHaveText('Synthetic audio session connected.');
        expect(await page.evaluate(() => ({ captures: captureCalls, joins: joinAttempts }))).toEqual({ captures: 2, joins: 1 });
        await page.getByRole('button', { name: 'Leave session', exact: true }).press('Enter');
        await expect.poll(() => page.evaluate(() => captureTracks.every(track => track.readyState === 'ended')
            && audioContexts.every(context => context.state === 'closed'))).toBe(true);
        expect(external).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
    test(`completing a listening join preserves Audio details keyboard focus at ${width}px`, async ({ page, baseURL }, testInfo) => {
        await page.setViewportSize({ width, height });
        const external = await routeProtectedListen(page, baseURL, `
            export class WebJoinSession {
                constructor(options) { this.options = options; }
                join() {
                    return new Promise(resolve => {
                        window.finishListening = () => { this.options.onStatus('Connected'); resolve(); };
                    });
                }
                close() {}
            }`);
        await page.addInitScript(() => {
            window.micRequests = 0;
            Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', {
                configurable: true, value: async () => { window.micRequests++; throw new Error('Listen-only fixture'); }
            });
        });
        const capability = Buffer.alloc(32, 17).toString('base64url');
        const expires = Math.floor(Date.now() / 1000) + 300;
        await page.goto(`/join/#k=${capability}&s=${'22'.repeat(32)}&g=1&e=${expires}`);
        const listen = page.getByRole('button', { name: 'Join to listen', exact: true });
        const leave = page.getByRole('button', { name: 'Leave session', exact: true });
        const details = page.getByText('Audio details', { exact: true });
        await listen.press('Enter');
        await expect(leave).toBeFocused();
        const tab = process.platform === 'darwin' && page.context().browser()?.browserType().name() === 'webkit' ? 'Alt+Tab' : 'Tab';
        await page.keyboard.press(tab);
        await expect(details).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.locator('details')).toHaveAttribute('open', '');
        await page.screenshot({ path: testInfo.outputPath('01-listening-connecting-audio-details.png') });
        await page.waitForFunction(() => typeof window.finishListening === 'function');
        await page.evaluate(() => window.finishListening());
        await expect(page.locator('#status')).toHaveText('Connected. You’re listening with your microphone off.');
        await expect(details).toBeFocused();
        await expect(details).toBeInViewport();
        await page.screenshot({ path: testInfo.outputPath('02-listening-connected-audio-details.png') });
        await leave.click();
        await expect(listen).toBeVisible();
        expect(await page.evaluate(() => window.micRequests)).toBe(0);
        expect(external).toEqual([]);
    });

    test(`an unverified host requires a fresh browser invite at ${width}px`, async ({ page, baseURL }, testInfo) => {
        await page.setViewportSize({ width, height });
        const external = await routeProtectedListen(page, baseURL, `
            export class WebJoinSession {
                async join() { throw new Error('Host identity or invite binding did not match'); }
                close() {}
            }`);
        const capability = Buffer.alloc(32, 17).toString('base64url');
        const expires = Math.floor(Date.now() / 1000) + 300;
        await page.goto(`/join/#k=${capability}&s=${'22'.repeat(32)}&g=1&e=${expires}`);
        await page.getByRole('button', { name: 'Join to listen', exact: true }).press('Enter');
        const status = page.locator('#status');
        await expect(status).toHaveText('WebJam couldn’t verify this invite.');
        await expect(status).toBeFocused();
        await page.evaluate(() => {
            window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        });
        await expect(status).toHaveText('WebJam couldn’t verify this invite.');
        await expect(status).toHaveAccessibleDescription('Ask your host for a fresh browser invite and open the new link.');
        await expect(page.locator('#error-hint')).toBeInViewport({ ratio: 1 });
        for (const id of ['listen-actions', 'prejoin', 'join', 'retry', 'audio-options', 'leave']) {
            await expect(page.locator('#' + id)).toBeHidden();
        }
        expect(external).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath('unverified-invite-fresh-link.png') });
    });
}

for (const width of [375, 390]) {
    for (const kind of ['missing', 'malformed', 'expired']) {
        test(`the packaged website gives ${kind} invites a usable fresh-link recovery at ${width}px without capture`, async ({ page, baseURL }) => {
            await page.setViewportSize({ width, height: 844 });
            await page.addInitScript(() => {
                window.captureCalls = 0;
                for (const name of ['getUserMedia', 'getDisplayMedia']) {
                    Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), name, {
                        configurable: true, value: async () => { window.captureCalls++; throw new Error('No capture for an unusable invite'); }
                    });
                }
            });
            const external = [];
            await page.route('**/*', route => {
                if (new URL(route.request().url()).origin === baseURL) return route.continue();
                external.push(route.request().url()); return route.abort();
            });
            const expires = Math.floor(Date.now() / 1000) - 1;
            const value = kind === 'missing' ? '' : kind === 'malformed' ? '#k=truncated' :
                `#k=${Buffer.alloc(32, 17).toString('base64url')}&s=${'22'.repeat(32)}&g=1&e=${expires}`;
            await page.goto(`/join/${value}`);
            await expect(page.locator('#status')).toHaveAttribute('data-failure', 'true');
            await expect(page.locator('#error-hint')).toHaveText('Ask your host for a new browser invite and open the full link.');
            await expect(page.locator('#error-hint')).not.toContainText(/retry/i);
            for (const id of ['prejoin', 'join', 'retry', 'leave']) await expect(page.locator(`#${id}`)).toBeHidden();
            expect(await page.evaluate(() => window.captureCalls)).toBe(0);
            expect(external).toEqual([]);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        });
    }
}

for (const width of [375, 390]) {
    for (const dailyHint of [false, true]) {
        test(`the website preserves fragment privacy and recovers provider failure at ${width}px (daily reset hint: ${dailyHint})`, async ({ page, baseURL }, testInfo) => {
            const external = [], requests = [];
            await page.setViewportSize({ width, height: width === 375 ? 667 : 844 });
            await page.addInitScript(() => {
                window.captureTracks = []; window.captureCount = 0;
                Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', {
                    configurable: true, value: async () => {
                        window.captureCount++;
                        const context = new AudioContext();
                        const stream = context.createMediaStreamDestination().stream;
                        for (const track of stream.getTracks()) {
                            const stop = track.stop.bind(track);
                            track.stop = () => { stop(); context.close().catch(() => {}); };
                            track.getSettings = () => ({ channelCount: 1, sampleRate: 16000 });
                            window.captureTracks.push(track);
                        }
                        return stream;
                    }
                });
            });
            page.on('request', request => requests.push(request.url()));
            await page.route('**/*', route => {
                const address = new URL(route.request().url());
                if (address.origin === baseURL) return route.continue();
                external.push(address.href);
                if (address.origin === 'https://webjam-turn-credentials.jeffstory007.workers.dev') {
                    if (external.length === 1) return route.fulfill({ status: 503, body: 'unavailable' });
                    return route.fulfill({ status: 429, json: { error: 'cap' }, ...(dailyHint ? {
                        headers: { 'Retry-After': '60', 'Access-Control-Expose-Headers': 'Retry-After' }
                    } : {}) });
                }
                return route.abort();
            });
            const capability = Buffer.alloc(32, 17).toString('base64url'), session = '22'.repeat(32);
            await page.goto(`/join/#k=${capability}&s=${session}&g=1&e=${Math.floor(Date.now() / 1000) + 300}`);
            await expect(page.locator('#status')).toContainText('Your host invited you');
            expect(await page.evaluate(() => window.captureCount)).toBe(0);
            expect(external).toEqual([]);
            const join = page.getByRole('button', { name: 'Join with microphone', exact: true });
            const retry = page.getByRole('button', { name: 'Retry', exact: true });
            await expect(join).toBeInViewport({ ratio: 1 });
            await page.getByRole('button', { name: 'Skip check', exact: true }).press('Enter');
            await expect(page.getByRole('checkbox')).toBeFocused();
            await page.keyboard.press('Space');
            await expect(join).toBeEnabled();
            await expect(join).toBeInViewport({ ratio: 1 });
            expect(await page.evaluate(() => window.captureCount)).toBe(0);
            await join.press('Enter');
            await expect(page.locator('#status')).toContainText('Web Join is unavailable');
            await expect(retry).toBeFocused();
            await expect(page.getByText('Your mic is using voice-quality audio.')).toBeVisible();
            await expect(page.locator('#warnings')).toBeHidden();
            await page.getByText('Audio details', { exact: true }).click();
            await expect(page.locator('#warnings')).toContainText('sampleRate: requested 48000, actual 16000');
            await expect(page.locator('#warnings')).toBeVisible();
            await page.getByText('Audio details', { exact: true }).click();
            await expect(join).toBeHidden();
            await expect(retry).toBeVisible();
            await expect(page.getByRole('button', { name: 'Leave session', exact: true })).toBeHidden();
            expect(await page.evaluate(() => captureTracks.length > 0 && captureTracks.every(track => track.readyState === 'ended'))).toBe(true);
            expect(external).toHaveLength(1);
            await retry.press('Enter');
            await expect(page.locator('#status')).toHaveText('Web Join reached a usage limit.');
            await expect(page.locator('#status')).toBeFocused();
            await expect(page.locator('#error-hint')).toContainText(dailyHint
                ? 'daily request allowance resets around' : 'Ask for a new browser invite');
            await expect(retry).toBeHidden();
            await expect.poll(() => page.evaluate(() => window.captureCount)).toBe(2);
            expect(await page.evaluate(() => captureTracks.every(track => track.readyState === 'ended'))).toBe(true);
            expect(external).toHaveLength(2);
            for (const address of requests) { expect(address).not.toContain(capability); expect(address).not.toContain(session); }
            expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(capability);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await page.screenshot({ path: testInfo.outputPath(`webjam-join-${width}.png`) });
        });
    }
}

for (const width of [375, 390]) {
    for (const name of ['NotAllowedError', 'NotFoundError']) {
        test(`packaged microphone check recovers ${name} at ${width}px without connecting`, async ({ page }) => {
            await page.setViewportSize({ width, height: 844 });
            await page.addInitScript(({ name }) => {
                window.captureCount = 0;
                Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', {
                    configurable: true,
                    value: async () => { window.captureCount++; throw new DOMException('Fixture microphone failure', name); }
                });
            }, { name });
            const external = [];
            await page.route('https://webjam-turn-credentials.jeffstory007.workers.dev/**', route => {
                external.push(route.request().url()); return route.abort();
            });
            const capability = Buffer.alloc(32, 17).toString('base64url');
            await page.goto(`/join/#k=${capability}&s=${'22'.repeat(32)}&g=1&e=${Math.floor(Date.now() / 1000) + 300}`);
            expect(await page.evaluate(() => window.captureCount)).toBe(0);
            await page.getByRole('button', { name: 'Check microphone', exact: true }).press('Enter');
            await expect(page.locator('#mic-error')).toContainText(name === 'NotAllowedError' ? 'Microphone access was blocked' : 'No microphone found');
            await expect(page.locator('#join')).toBeDisabled();
            const retry = page.getByRole('button', { name: 'Try again', exact: true });
            await expect(retry).toBeFocused();
            await page.keyboard.press('Enter');
            await expect.poll(() => page.evaluate(() => window.captureCount)).toBe(2);
            await expect(retry).toBeFocused();
            expect(external).toEqual([]);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        });
    }
}

const alternateMicrophoneCases = [
    { width: 375, errorName: 'NotReadableError' },
    { width: 390, errorName: 'NotReadableError' },
    { width: 375, errorName: 'NotFoundError' },
    { width: 390, errorName: 'NotFoundError' },
];
for (const { width, errorName } of alternateMicrophoneCases) {
    test(`the packaged website offers an alternate microphone after ${errorName} at ${width}px`, async ({ page, baseURL }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.addInitScript((failure) => {
            window.captureInputs = [];
            const media = Object.getPrototypeOf(navigator.mediaDevices);
            media.enumerateDevices = async () => [{ kind: 'audioinput', deviceId: 'alternate', label: 'USB headset' }];
            media.getUserMedia = async ({ audio }) => {
                const selection = audio.deviceId?.exact ?? '';
                window.captureInputs.push(selection);
                if (selection !== 'alternate') throw new DOMException('Fixture default input failed', failure);
                const audioContext = new AudioContext();
                const output = audioContext.createMediaStreamDestination();
                const tone = audioContext.createOscillator();
                const gain = audioContext.createGain();
                gain.gain.value = 0.08;
                tone.connect(gain).connect(output);
                tone.start();
                await audioContext.resume();
                const track = output.stream.getAudioTracks()[0];
                const stop = track.stop.bind(track);
                track.stop = () => { stop(); audioContext.close().catch(() => {}); };
                return output.stream;
            };
        }, errorName);
        const external = [];
        await page.route('**/*', route => {
            if (new URL(route.request().url()).origin === new URL(baseURL).origin) return route.continue();
            external.push(route.request().url());
            return route.abort();
        });
        const capability = Buffer.alloc(32, 17).toString('base64url');
        await page.goto(`/join/#k=${capability}&s=${'22'.repeat(32)}&g=1&e=${Math.floor(Date.now() / 1000) + 300}`);
        const picker = page.getByLabel('Microphone', { exact: true });
        await expect(picker).toBeHidden();
        expect(await page.evaluate(() => window.captureInputs)).toEqual([]);
        await page.getByRole('button', { name: 'Check microphone', exact: true }).press('Enter');
        await expect(page.locator('#mic-error')).toContainText(
            errorName === 'NotFoundError' ? 'Choose another input if available' : "Couldn't open this microphone",
        );
        await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused();
        await expect(picker).toBeVisible();
        expect(await page.evaluate(() => window.captureInputs)).toEqual(['']);
        await page.keyboard.press('Tab');
        await expect(picker).toBeFocused();
        await picker.selectOption({ label: 'USB headset' });
        await expect(page.getByText('Microphone detected.', { exact: true })).toBeVisible();
        await page.getByRole('checkbox').check();
        await expect(page.locator('#join')).toBeEnabled();
        expect(await page.evaluate(() => window.captureInputs)).toEqual(['', 'alternate']);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(external).toEqual([]);
    });
}

for (const width of [375, 390]) {
    test(`the packaged website can check the default microphone without a device list at ${width}px`, async ({ page, baseURL }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.addInitScript(() => {
            window.captureCount = 0;
            const media = Object.getPrototypeOf(navigator.mediaDevices);
            media.enumerateDevices = async () => { throw new DOMException('Fixture device list unavailable', 'NotAllowedError'); };
            media.getUserMedia = async () => {
                window.captureCount++;
                const audioContext = new AudioContext();
                const output = audioContext.createMediaStreamDestination();
                const tone = audioContext.createOscillator();
                const gain = audioContext.createGain();
                gain.gain.value = 0.08;
                tone.connect(gain).connect(output);
                tone.start();
                await audioContext.resume();
                const track = output.stream.getAudioTracks()[0];
                const stop = track.stop.bind(track);
                track.stop = () => { stop(); audioContext.close().catch(() => {}); };
                return output.stream;
            };
        });
        const external = [];
        const origin = new URL(baseURL).origin;
        await page.route('**/*', route => {
            if (new URL(route.request().url()).origin === origin) return route.continue();
            external.push(route.request().url());
            return route.abort();
        });
        const capability = Buffer.alloc(32, 17).toString('base64url');
        await page.goto(`/join/#k=${capability}&s=${'22'.repeat(32)}&g=1&e=${Math.floor(Date.now() / 1000) + 300}`);
        expect(await page.evaluate(() => window.captureCount)).toBe(0);
        await page.getByRole('button', { name: 'Check microphone', exact: true }).press('Enter');
        await expect(page.getByText('Microphone detected.', { exact: true })).toBeVisible();
        await expect(page.locator('#mic-error')).toBeEmpty();
        await expect(page.getByLabel('Microphone', { exact: true })).toBeHidden();
        await expect(page.getByRole('checkbox')).toBeFocused();
        await page.keyboard.press('Space');
        await expect(page.locator('#join')).toBeEnabled();
        expect(await page.evaluate(() => window.captureCount)).toBe(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(external).toEqual([]);
    });
}

// Ownership regressions exercise the shipped module through the website URL.
// Adapted from WebJam failure-recovery.spec.js at01ffdc8 (MIT; see join/LICENSE).
async function openOwnedInvitation(page, width = 390, skipCheck = true, { holdCapture = false } = {}) {
  await page.setViewportSize({ width, height: 844 });
  await page.clock.install();
  await page.addInitScript(({ skipCheck, holdCapture }) => {
    window.captureTracks = [];
    if (holdCapture) window.pendingCaptures = [];
    const nativeContext = window.AudioContext;
    window.audioContexts = [];
    window.AudioContext = class extends nativeContext {
      constructor(...args) { super(...args); window.audioContexts.push(this); }
    };
    Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', {
      configurable: true,
      value: async () => {
        // Synthetic audio only; never request the tester's microphone.
        const context = new AudioContext();
        const output = context.createMediaStreamDestination();
        const { stream } = output;
        if (!skipCheck) {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          gain.gain.value = 0.08;
          oscillator.connect(gain).connect(output);
          oscillator.start();
          await context.resume();
        }
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => { stop(); context.close().catch(() => {}); };
          window.captureTracks.push(track);
        }
        return holdCapture ? new Promise(resolve => pendingCaptures.push(() => resolve(stream))) : stream;
      }
    });
  }, { skipCheck, holdCapture });
  const expires = Math.floor(Date.now() / 1000) + 300;
  // Local test-only capability, with no corresponding host or mailbox.
  await page.goto(`/join/#k=${Buffer.alloc(32, 17).toString('base64url')}&s=${'22'.repeat(32)}&g=1&e=${expires}`);
  await page.getByRole('checkbox').check();
  if (skipCheck) await page.getByRole('button', { name: 'Skip check' }).click();
}

for (const width of [375, 390, 1440]) for (const focus of ['join', 'details']) {
  test(`a lost checked microphone recovers keyboard focus from ${focus} at ${width}px`, async ({ page, baseURL }, testInfo) => {
    const external = await routeProtectedListen(page, baseURL, `
      export class WebJoinSession {
        constructor() { window.unexpectedJoinAttempts = (window.unexpectedJoinAttempts || 0) + 1; }
        async join() { throw new Error('Prejoin recovery never starts a session'); }
        close() {}
      }`);
    await openOwnedInvitation(page, width, false);
    const join = page.getByRole('button', { name: 'Join with microphone', exact: true });
    const check = page.getByRole('button', { name: 'Check microphone', exact: true });
    const retry = page.getByRole('button', { name: 'Try again', exact: true });
    const details = page.locator('details summary');
    expect(await page.evaluate(() => captureTracks.length)).toBe(0);
    await check.press('Enter');
    await expect(page.getByText('Microphone detected.', { exact: true })).toBeVisible();
    await expect(join).toBeEnabled(); await expect(join).toBeFocused();
    if (focus === 'details') {
      await page.keyboard.press('Tab');
      await expect(details).toBeFocused();
    }
    await page.evaluate(() => {
      captureTracks[0].stop();
      captureTracks[0].dispatchEvent(new Event('ended'));
    });
    await expect(page.locator('#mic-error')).toContainText('Microphone disconnected');
    await expect(join).toBeDisabled();
    await expect(page.locator('#mic-heard')).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath(`mic-lost-${focus}-${width}.png`) });
    await expect(focus === 'join' ? retry : details).toBeFocused();
    await expect(focus === 'join' ? retry : details).toBeInViewport({ ratio: 1 });
    if (focus === 'details') {
      for (let step = 0; step < 20 && !await retry.evaluate(button => button === document.activeElement); step++) {
        await page.keyboard.press('Shift+Tab');
      }
      await expect(retry).toBeFocused();
    }
    await page.keyboard.press('Enter');
    await expect(page.getByText('Microphone detected.', { exact: true })).toBeVisible();
    await expect(join).toBeEnabled(); await expect(join).toBeFocused();
    expect(await page.evaluate(() => ({ captures: captureTracks.length, joins: window.unexpectedJoinAttempts || 0 })))
      .toEqual({ captures: 2, joins: 0 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`mic-recovered-${focus}-${width}.png`) });
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await expect.poll(() => page.evaluate(() => captureTracks.every(track => track.readyState === 'ended')
      && audioContexts.every(context => context.state === 'closed'))).toBe(true);
    expect(external).toEqual([]);
  });
}

test('losing the checked microphone clears Join readiness until a deliberate recheck', async ({ page }) => {
  await openOwnedInvitation(page, 390, false);
  await page.getByRole('button', { name: 'Check microphone', exact: true }).click();
  await expect(page.locator('#join')).toBeEnabled();
  await page.evaluate(() => {
    captureTracks[0].stop();
    captureTracks[0].dispatchEvent(new Event('ended'));
  });
  await expect(page.locator('#mic-error')).toContainText('Microphone disconnected');
  await expect(page.locator('#mic-heard')).toBeHidden();
  await expect(page.locator('#join')).toBeDisabled();
  expect(await page.evaluate(() => captureTracks.length)).toBe(1);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('#join')).toBeEnabled();
  expect(await page.evaluate(() => captureTracks.length)).toBe(2);
  await page.evaluate(() => captureTracks[0].dispatchEvent(new Event('ended')));
  await expect(page.locator('#join')).toBeEnabled();
});

for (const skipCheck of [false, true]) {
  test(`losing an enrolled microphone closes the audio session after ${skipCheck ? 'skipping' : 'passing'} the mic check`, async ({ page }) => {
    await page.route('**/join/session.js', route => route.fulfill({ contentType: 'text/javascript', body: `
      export class WebJoinSession {
        constructor(options) { this.options = options; }
        async join() { this.options.onStatus('Synthetic session connected.'); }
        close() {
          window.micLossSessionClosed = true;
          this.options.stream.getTracks().forEach(track => track.stop());
        }
      }` }));
    await openOwnedInvitation(page, 390, skipCheck);
    if (!skipCheck) {
      await page.getByRole('button', { name: 'Check microphone', exact: true }).click();
      await expect(page.locator('#join')).toBeEnabled();
    }
    await page.locator('#join').click();
    await expect(page.locator('#status')).toHaveText('Synthetic session connected.');
    await page.evaluate(() => {
      captureTracks[0].stop();
      captureTracks[0].dispatchEvent(new Event('ended'));
    });
    await expect(page.locator('#status')).toHaveText('Microphone disconnected.');
    await expect(page.locator('#error-hint')).toContainText('new browser invite');
    for (const id of ['join', 'retry', 'leave', 'prejoin']) await expect(page.locator('#' + id)).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.micLossSessionClosed && audioContexts.every(context => context.state === 'closed'))).toBe(true);
    expect(await page.evaluate(() => captureTracks.length)).toBe(1);
  });
}

for (const outcome of ['rejoining', 'failed']) {
  test(`retired enrollment callbacks preserve the ${outcome} attempt`, async ({ page }) => {
    await page.route('**/join/session.js', route => route.fulfill({ contentType: 'text/javascript', body: `
      export class WebJoinSession {
        constructor(options) { this.options = options; this.id = (window.pendingSessions ??= []).push(this); }
        join() {
          this.options.onStatus('Attempt ' + this.id + ' pending.');
          return new Promise(resolve => { this.finish = () => {
            this.options.onStatus('Stale completed enrollment.'); this.options.onLatency(999);
            this.options.onError(new Error('Stale enrollment error.')); resolve();
          }; });
        }
        close() { this.closed = true; this.options.stream.getTracks().forEach(t => t.stop()); }
      }` }));
    await openOwnedInvitation(page);
    const join = page.getByRole('button', { name: 'Join with microphone', exact: true });
    const leave = page.getByRole('button', { name: 'Leave session', exact: true });
    await join.press('Enter');
    await expect(page.locator('#status')).toHaveText('Attempt 1 pending.');
    await expect(leave).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(join).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#status')).toHaveText('Attempt 2 pending.');
    if (outcome === 'failed') await page.evaluate(() => pendingSessions[1].options.onError(new Error('Current enrollment failed.')));
    await page.evaluate(() => pendingSessions[0].finish());
    await expect(page.locator('#status')).toHaveText(outcome === 'failed' ? 'Current enrollment failed.' : 'Attempt 2 pending.');
    await expect(page.locator('#latency')).not.toContainText('999');
    if (outcome === 'failed') await expect(page.locator('#retry')).toBeVisible();
    else { expect(await page.evaluate(() => !!pendingSessions[1].closed)).toBe(false); await leave.click(); }
    expect(await page.evaluate(() => captureTracks.every(track => track.readyState === 'ended'))).toBe(true);
  });
}

test('a retired initial resume cannot enable Join while the next resume is pending', async ({ page }) => {
  await openOwnedInvitation(page);
  await page.evaluate(() => {
    window.pendingResumes = [];
    const nativeResume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function () {
      // Delay the JS completion, preserving WebKit's real context lifecycle.
      const resumed = nativeResume.call(this);
      resumed.catch(() => {});
      return new Promise((resolve, reject) => pendingResumes.push(() => resumed.then(resolve, reject)));
    };
  });
  const join = page.getByRole('button', { name: 'Join with microphone', exact: true });
  await join.click(); await expect.poll(() => page.evaluate(() => pendingResumes.length)).toBe(1);
  await expect(page.locator('#check-mic')).toBeDisabled();
  await page.getByRole('button', { name: 'Leave session', exact: true }).click();
  await join.click(); await expect.poll(() => page.evaluate(() => pendingResumes.length)).toBe(2);
  await page.evaluate(() => pendingResumes[0]());
  await expect(join).toBeDisabled();
  await page.getByRole('button', { name: 'Leave session', exact: true }).click();
  await page.evaluate(() => pendingResumes[1]());
  await expect.poll(() => page.evaluate(() => audioContexts.every(context => context.state === 'closed'))).toBe(true);
});

test('capture arriving after Leave releases only its own tracks during the next Join', async ({ page, baseURL }) => {
  const unexpected = [];
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === new URL(baseURL).origin) return route.continue();
    unexpected.push(route.request().resourceType());
    return route.abort();
  });
  await openOwnedInvitation(page, 390, true, { holdCapture: true });
  const join = page.getByRole('button', { name: 'Join with microphone', exact: true });
  const leave = page.getByRole('button', { name: 'Leave session', exact: true });
  await join.click(); await expect.poll(() => page.evaluate(() => pendingCaptures.length)).toBe(1);
  await leave.click(); await join.click();
  await expect.poll(() => page.evaluate(() => pendingCaptures.length)).toBe(2);
  await page.evaluate(() => pendingCaptures[0]());
  await expect.poll(() => page.evaluate(() => captureTracks[0].readyState)).toBe('ended');
  expect(await page.evaluate(() => captureTracks[1].readyState)).toBe('live');
  await expect(join).toBeDisabled();
  await expect(page.locator('#status')).toHaveText('Allow microphone access to play with your host.');
  await leave.click(); await page.evaluate(() => pendingCaptures[1]());
  await expect.poll(() => page.evaluate(() => captureTracks.every(track => track.readyState === 'ended'))).toBe(true);
  await expect.poll(() => page.evaluate(() => audioContexts.every(context => context.state === 'closed'))).toBe(true);
  expect(unexpected).toEqual([]);
});

// Exercises the packaged protected UI with an inert same-origin issuer and
// inert session transport. Production cookie/room authority is tested against
// the actual Worker and lobby in the SQLite authority suite.
for (const outcome of ['quota refusal', 'revocation after joining', 'revocation on foreground return', 'heartbeat expiring during a pending check']) {
    test(`protected Music ${outcome} respects explicit audio join and capture ownership`, async ({ page, baseURL }) => {
        const requests = [], external = [];
        const grant = '9'.repeat(32), proof = '5'.repeat(64);
        const expires = Math.floor(Date.now() / 1000) + 240;
        let withdrawn = false;
        const foreground = outcome === 'revocation on foreground return';
        const deadline = outcome === 'heartbeat expiring during a pending check';
        if (deadline) await page.clock.install();
        await page.addInitScript(({ grant, proof, foreground }) => {
            sessionStorage.setItem(`webjam-private-music-${grant}`, proof);
            window.musicCapture = [];
            Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', {
                configurable: true,
                value: async () => {
                    const context = new AudioContext();
                    const stream = context.createMediaStreamDestination().stream;
                    const track = stream.getAudioTracks()[0];
                    const stop = track.stop.bind(track);
                    track.stop = () => { stop(); void context.close(); };
                    window.musicCapture.push(track);
                    return stream;
                }
            });
            if (foreground) {
                // Only the visibility event can send a heartbeat in this case.
                const schedule = window.setTimeout.bind(window);
                window.setTimeout = (callback, delay, ...args) => schedule(delay === 4000 ? () => {} : callback, delay, ...args);
            }
        }, { grant, proof, foreground });
        await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin !== baseURL) { external.push(url.origin); return route.abort(); }
            if (url.pathname === '/join/') {
                const html = readFileSync(resolve(__dirname, '../../.beta-assets/join/index.html'), 'utf8');
                return route.fulfill({ contentType: 'text/html', body: html.replace('<head>', '<head><meta name="private-music" content="required">') });
            }
            if (url.pathname === '/join/app.js') {
                return route.fulfill({ path: resolve(__dirname, '../../.beta-assets/join/app.js'), contentType: 'text/javascript' });
            }
            if (url.pathname === '/join/session.js') return route.fulfill({ contentType: 'text/javascript', body: `
                export class WebJoinSession {
                    constructor({ stream, grantedCredentials }) {
                        this.stream = stream;
                        this.accessExpiresAt = grantedCredentials.expiresAt;
                    }
                    async join() { window.musicTransportOpen = true; }
                    close() { for (const track of this.stream.getTracks()) track.stop(); window.musicTransportOpen = false; }
                }
            ` });
            if (url.pathname !== '/beta/music') return route.continue();
            const { op, id, proof: supplied } = route.request().postDataJSON();
            requests.push({ op, matched: id === grant && supplied === proof });
            if (deadline && op === 'check') return;
            if (op === 'join') {
                if (outcome === 'quota refusal') return route.fulfill({ status: 429, json: { error: 'cap' } });
                return route.fulfill({ json: {
                    href: `${baseURL}/join/#k=${Buffer.alloc(32, 1).toString('base64url')}&s=${'2'.repeat(64)}&g=1&e=${expires}`,
                    credentials: { client: 'web', ttl: 120, quota_bytes: 256 * 1024 * 1024, iceServers: [{
                        urls: 'turn:turn.cloudflare.com:3478?transport=udp', username: 'fixture', credential: 'inert'
                    }] }
                } });
            }
            return route.fulfill({ status: op === 'check' && withdrawn ? 403 : 200, json: {} });
        });
        await page.goto(`/join/#m=${grant}&e=${expires}`);
        await expect(page.locator('#status')).toContainText('Your host invited you');
        expect(await page.evaluate(() => location.hash === '' && window.musicCapture.length === 0)).toBe(true);
        expect(requests).toEqual([]);
        await page.getByRole('button', { name: 'Skip check', exact: true }).click();
        await page.getByRole('checkbox').check();
        await page.getByRole('button', { name: 'Join with microphone', exact: true }).click();
        if (outcome === 'quota refusal') {
            await expect(page.locator('#status')).toHaveText('Web Join reached a usage limit.');
            expect(await page.evaluate(() => window.musicCapture.length)).toBe(0);
        } else {
            const leave = page.getByRole('button', { name: 'Leave session', exact: true });
            await expect(leave).toBeVisible();
            await expect.poll(() => page.evaluate(() => window.musicTransportOpen === true && window.musicCapture[0]?.readyState === 'live')).toBe(true);
            withdrawn = true;
            if (foreground) {
                expect(requests.map(request => request.op)).toEqual(['join']);
                await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
            }
            if (deadline) {
                await page.clock.fastForward(4000);
                await expect.poll(() => requests.map(request => request.op)).toEqual(['join', 'check']);
                expect(await page.evaluate(() => window.musicCapture[0].readyState)).toBe('live');
                await page.clock.fastForward(11000);
            }
            await expect(leave).toBeHidden();
            expect(await page.evaluate(() => window.musicTransportOpen === false && window.musicCapture[0]?.readyState === 'ended')).toBe(true);
        }
        await expect.poll(() => requests.filter(request => request.op === 'stop').length).toBe(1);
        expect(requests.filter(request => request.op === 'join')).toEqual([{ op: 'join', matched: true }]);
        if (deadline) expect(requests.map(request => request.op)).toEqual(['join', 'check', 'stop']);
        expect(requests.every(request => request.matched)).toBe(true);
        expect(external).toEqual([]);
    });
}
