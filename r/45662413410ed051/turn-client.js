/* Short-lived TURN credentials stay in memory. Failure keeps direct connections available. */
(function initTurnClient(global) {
    'use strict';
    const STUN = Object.freeze([{ urls: 'stun:stun.cloudflare.com:3478' }]);
    const signedDevice = (token) => /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{32}$/.test(String(token || ''));

    function createTurnClient({ url, preview, room, getDevice, fetchImpl = global.fetch.bind(global), now = Date.now,
        setTimer = global.setTimeout.bind(global), clearTimer = global.clearTimeout.bind(global), onChange = () => {}, onStatus = () => {} }) {
        let servers = STUN.slice(), pending = null, timer = null, retryAt = 0, refreshAt = 0, expiresAt = 0, stopped = false;
        const update = (next) => { servers = next; onChange(next); };
        const schedule = (at) => {
            clearTimer(timer);
            if (!stopped) timer = setTimer(() => { timer = null; get(); }, Math.min(2147483647, Math.max(1, at - now())));
        };
        async function load(device) {
            const controller = new AbortController();
            const deadline = setTimer(() => controller.abort(), 8000);
            const payload = { preview, room };
            if (signedDevice(device)) payload.device = device;
            try {
                const response = await fetchImpl(url, { method: 'POST', credentials: 'same-origin', redirect: 'error',
                    headers: { 'content-type': 'application/json' }, signal: controller.signal,
                    body: JSON.stringify(payload) });
                if (stopped) return servers;
                if (controller.signal.aborted) throw new Error('timeout');
                if (!response.ok) {
                    let data = {};
                    try { data = await response.json(); } catch (_) { /* generic status only */ }
                    retryAt = data.reason === 'budget used'
                        ? Date.UTC(new Date(now()).getUTCFullYear(), new Date(now()).getUTCMonth() + 1, 1)
                        : now() + (response.status === 429 ? Math.max(30, Math.min(600, Number(data.retryAfter) || 600)) : 60) * 1000;
                    throw new Error('unavailable');
                }
                const data = await response.json();
                if (stopped) return servers;
                if (controller.signal.aborted) throw new Error('timeout');
                if (!Array.isArray(data.iceServers) || !data.iceServers.length || data.iceServers.length > 16 ||
                    !Number.isFinite(data.ttl) || data.ttl < 60 || data.ttl > 600 ||
                    !Number.isFinite(data.expiresAt) || data.expiresAt <= now()) throw new Error('invalid');
                const ice = data.iceServers.map((server) => {
                    const urls = typeof server.urls === 'string' ? [server.urls] : server.urls;
                    if (!Array.isArray(urls) || !urls.length || urls.length > 16 || urls.some((u) => typeof u !== 'string' || !/^(stun|turn|turns):[^\s]+$/.test(u))) throw new Error('invalid');
                    const relay = urls.some((u) => /^turns?:/.test(u));
                    if (relay && (typeof server.username !== 'string' || !server.username || typeof server.credential !== 'string' || !server.credential)) throw new Error('invalid');
                    return { urls, ...(relay ? { username: server.username, credential: server.credential } : {}) };
                });
                expiresAt = Math.min(data.expiresAt, now() + data.ttl * 1000);
                refreshAt = Math.max(now() + 1000, expiresAt - Math.min(120000, data.ttl * 200));
                retryAt = 0;
                update(STUN.concat(ice));
                onStatus('ready');
                schedule(refreshAt);
            } catch (_) {
                if (!stopped) {
                    expiresAt = 0; refreshAt = 0;
                    retryAt = Math.max(retryAt, now() + 30000);
                    update(STUN.slice());
                    onStatus('direct-only');
                    schedule(retryAt);
                }
            } finally { clearTimer(deadline); }
            return servers;
        }
        function get() {
            if (stopped || !url) return Promise.resolve(servers);
            if (pending) return pending;
            if (now() < retryAt) { schedule(retryAt); return Promise.resolve(servers); }
            if (expiresAt && now() < refreshAt) return Promise.resolve(servers);
            const device = getDevice();
            if (!signedDevice(device)) {
                onStatus('device-required');
                pending = load('').finally(() => { pending = null; });
                return pending;
            }
            pending = load(device).finally(() => { pending = null; });
            return pending;
        }
        return { get, stop() { stopped = true; clearTimer(timer); update(STUN.slice()); },
            status: () => ({ expiresAt, retryAt, pending: !!pending }) };
    }
    const api = { createTurnClient, signedDevice };
    if (typeof module === 'object' && module.exports) module.exports = api;
    global.HangoutTurn = api;
}(typeof window !== 'undefined' ? window : globalThis));
