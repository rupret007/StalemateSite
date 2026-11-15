const { test, expect } = require('@playwright/test');

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
