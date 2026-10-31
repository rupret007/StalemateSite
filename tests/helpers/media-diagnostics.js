const { test: base, expect } = require('@playwright/test');

// Test-only observer. Return the original native play promise and never change
// media state, application clocks, playback gates or error handling.
function installMediaObserver() {
    const events = [], players = new Map();
    const time = () => Math.round(performance.now());
    const append = value => { events.push({ atMs: time(), ...value }); if (events.length > 160) events.shift(); };
    const state = audio => {
        const buffered = [];
        try {
            for (let i = 0; i < Math.min(audio.buffered.length, 8); i++) buffered.push([audio.buffered.start(i), audio.buffered.end(i)]);
        } catch { /* A concurrent media-buffer update must not break playback. */ }
        return { src: audio.currentSrc || audio.src, seconds: audio.currentTime,
        duration: Number.isFinite(audio.duration) ? audio.duration : null, paused: audio.paused,
        seeking: audio.seeking, ready: audio.readyState, network: audio.networkState,
        error: audio.error ? { code: audio.error.code, message: audio.error.message } : null,
        buffered };
    };
    function observe(audio) {
        if (players.has(audio)) return players.get(audio);
        const player = { id: players.size + 1, playCalls: 0 };
        players.set(audio, player);
        for (const event of ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'play', 'playing', 'waiting', 'stalled', 'seeking', 'seeked', 'timeupdate', 'pause', 'ended', 'error', 'emptied']) {
            audio.addEventListener(event, () => append({ event, id: player.id, ...state(audio) }));
        }
        return player;
    }
    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
        const player = observe(this);
        player.playCalls++;
        append({ event: 'play-request', id: player.id, ...state(this) });
        try {
            const result = Reflect.apply(nativePlay, this, args);
            result?.then(() => append({ event: 'play-resolved', id: player.id, ...state(this) }),
                error => append({ event: 'play-rejected', id: player.id, name: error.name, message: error.message, ...state(this) }));
            return result;
        } catch (error) {
            append({ event: 'play-threw', id: player.id, name: error.name, message: error.message });
            throw error;
        }
    };
    let lastTick = performance.now(), maxTimerDelayMs = 0, timerSamples = 0;
    setInterval(() => {
        const now = performance.now(), delay = Math.max(0, now - lastTick - 250);
        maxTimerDelayMs = Math.max(maxTimerDelayMs, Math.round(delay)); timerSamples++;
        if (delay > 500) append({ event: 'timer-delay', delayMs: Math.round(delay), hidden: document.hidden });
        lastTick = now;
    }, 250);
    let previousLabel = '';
    const label = () => document.querySelector('.suite-music-title')?.textContent || '';
    new MutationObserver(() => {
        const next = label();
        if (next !== previousLabel) { previousLabel = next; append({ event: 'label', text: next }); }
    }).observe(document, { subtree: true, childList: true, characterData: true });
    document.addEventListener('visibilitychange', () => append({ event: 'visibility', hidden: document.hidden }));
    window.__stalemateMediaDiagnostics = {
        read: () => ({ url: location.href, atMs: time(), hidden: document.hidden, label: label(),
            musicState: document.documentElement?.dataset.stalemateMusic,
            maxTimerDelayMs, timerSamples, events: [...events],
            players: Array.from(players, ([audio, player]) => ({ ...player, ...state(audio) })) })
    };
    // One bulk message per navigation retains the departing page without IPC on
    // every timeupdate (which would itself distort media/event timing).
    window.addEventListener('pagehide', () => {
        window.__retainMediaNavigation?.(window.__stalemateMediaDiagnostics.read()).catch(() => {});
    });
}

async function startMediaDiagnostics(page) {
    const network = [], documents = [], errors = [];
    const push = value => { network.push({ at: new Date().toISOString(), ...value }); if (network.length > 160) network.shift(); };
    const isMedia = request => /\.(m4a|mp4)(?:\?|$)/i.test(request.url());
    await page.exposeBinding('__retainMediaNavigation', (_, snapshot) => { documents.push(snapshot); if (documents.length > 12) documents.shift(); });
    await page.addInitScript(installMediaObserver);
    const request = r => { if (isMedia(r)) push({ event: 'request', url: r.url(), range: r.headers().range }); };
    const response = r => {
        if (isMedia(r.request())) {
            const h = r.headers();
            push({ event: 'response', url: r.url(), status: r.status(), headers: Object.fromEntries(['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'age', 'etag'].filter(k => h[k] !== undefined).map(k => [k, h[k]])) });
        }
    };
    const failed = r => { if (isMedia(r)) push({ event: 'request-failed', url: r.url(), error: r.failure()?.errorText, timing: r.timing() }); };
    const finished = r => { if (isMedia(r)) push({ event: 'request-finished', url: r.url(), timing: r.timing() }); };
    const pageerror = e => errors.push(e.message);
    page.on('request', request); page.on('response', response); page.on('requestfailed', failed);
    page.on('requestfinished', finished); page.on('pageerror', pageerror);
    return {
        async read() {
            const current = await page.evaluate(() => window.__stalemateMediaDiagnostics?.read()).catch(e => ({ diagnosticError: e.message }));
            return { collectedAt: new Date().toISOString(), documents: [...documents], current, network: [...network], errors: [...errors] };
        },
        stop() {
            page.off('request', request); page.off('response', response); page.off('requestfailed', failed);
            page.off('requestfinished', finished); page.off('pageerror', pageerror);
        }
    };
}

const test = base.extend({
    mediaDiagnostics: [async ({ page }, use, info) => {
        const observer = await startMediaDiagnostics(page);
        try { await use(observer); }
        finally {
            const snapshot = await observer.read(); observer.stop();
            // Include successful attempts so slow passes can be compared with the
            // FIRST failure. The report labels every attempt and retry explicitly.
            if (snapshot.current?.players?.length || snapshot.network.length || info.status !== info.expectedStatus) {
                await info.attach(`media-diagnostics-attempt-${info.retry + 1}`, {
                    body: JSON.stringify({ project: info.project.name, test: info.title, retry: info.retry,
                        status: info.status, ...snapshot }, null, 2), contentType: 'application/json'
                });
            }
        }
    }, { auto: true }]
});

module.exports = { test, expect, startMediaDiagnostics, installMediaObserver };
