import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const { createTurnClient, signedDevice } = createRequire(import.meta.url)('../../r/45662413410ed051/turn-client.js');
const DEVICE = `${'a'.repeat(22)}.${'b'.repeat(32)}`;
const ICE = [{ urls: ['turn:relay.example:3478'], username: 'fixture', credential: 'fixture-password' }];
const STUN = [{ urls: 'stun:stun.cloudflare.com:3478' }];
const good = () => ({ ok: true, status: 200, json: async () => ({ iceServers: ICE, ttl: 600, expiresAt: Date.now() + 600000 }) });
let fetchImpl, onChange, onStatus, clients;
function client(overrides = {}) {
    const c = createTurnClient({ url: '/turn', preview: 'fixture-preview', room: 'a'.repeat(64), getDevice: () => DEVICE,
        fetchImpl, onChange, onStatus, setTimer: setTimeout, clearTimer: clearTimeout, ...overrides });
    clients.push(c); return c;
}
beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
    fetchImpl = vi.fn(async () => good()); onChange = vi.fn(); onStatus = vi.fn(); clients = [];
});
afterEach(() => { clients.forEach((c) => c.stop()); vi.useRealTimers(); });

describe('private room TURN lifecycle', () => {
    it('requires a signed lobby device and never substitutes a chosen identifier', async () => {
        expect(signedDevice(DEVICE)).toBe(true);
        for (const device of ['', 'chosen-id', `${'a'.repeat(22)}.bad`]) {
            expect(await client({ getDevice: () => device }).get()).toEqual(STUN);
        }
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(onStatus).toHaveBeenCalledWith('device-required');
    });
    it('deduplicates concurrent fetches and sends the signed token only in the POST body', async () => {
        const c = client();
        const [a, b] = await Promise.all([c.get(), c.get()]);
        expect(a).toEqual(STUN.concat(ICE)); expect(b).toEqual(a);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, request] = fetchImpl.mock.calls[0];
        expect(url).toBe('/turn');
        expect(JSON.parse(request.body)).toEqual({ room: 'a'.repeat(64), preview: 'fixture-preview', device: DEVICE });
        expect(request.credentials).toBe('same-origin');
        expect(JSON.stringify(c.status())).not.toContain('fixture-password');
    });
    it('refreshes before expiry and publishes the replacement configuration', async () => {
        const c = client(); await c.get();
        await vi.advanceTimersByTimeAsync(480000);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(onChange).toHaveBeenCalledTimes(2);
        expect(c.status().expiresAt).toBe(Date.now() + 600000);
    });
    it('falls back to STUN and honors rate-limit retry timing', async () => {
        fetchImpl.mockResolvedValue({ ok: false, status: 429, json: async () => ({ reason: 'rate limited', retryAfter: 600 }) });
        const c = client(); expect(await c.get()).toEqual(STUN);
        await vi.advanceTimersByTimeAsync(599999); await c.get();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(onStatus).toHaveBeenCalledWith('direct-only');
    });
    it('does not repeatedly request credentials after the monthly budget is spent', async () => {
        fetchImpl.mockResolvedValue({ ok: false, status: 429, json: async () => ({ reason: 'budget used' }) });
        const c = client(); await c.get();
        await vi.advanceTimersByTimeAsync(86400000); await c.get();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(c.status().retryAt).toBe(Date.parse('2026-11-01T00:00:00Z'));
    });
    it.each([
        { iceServers: [{ urls: 'turn:relay.example' }], ttl: 600, expiresAt: 9999999999999 },
        { iceServers: ICE, ttl: 600 },
        { iceServers: ICE, ttl: 86400, expiresAt: 9999999999999 }
    ])('refuses malformed or unbounded credentials', async (data) => {
        fetchImpl.mockResolvedValue({ ok: true, json: async () => data });
        expect(await client().get()).toEqual(STUN);
    });
    it('aborts a stalled request after eight seconds and keeps direct connections', async () => {
        fetchImpl.mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('fixture timeout')));
        }));
        const pending = client().get();
        await vi.advanceTimersByTimeAsync(8000);
        expect(await pending).toEqual(STUN);
        expect(onStatus).toHaveBeenCalledWith('direct-only');
    });
    it('ignores a response arriving after the page has stopped its credential lifecycle', async () => {
        let resolve;
        fetchImpl.mockImplementation(() => new Promise((r) => { resolve = r; }));
        const c = client(); const pending = c.get(); c.stop(); resolve(good());
        expect(await pending).toEqual(STUN);
        expect(onChange).toHaveBeenCalledTimes(1); // stop clears the in-memory configuration
        await vi.advanceTimersByTimeAsync(600000);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});
