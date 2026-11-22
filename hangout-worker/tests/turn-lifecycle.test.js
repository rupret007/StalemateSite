// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { productFile } from '../../tests/support/product-room.cjs';
import { newDeviceId, signDevice } from '../src/auth.mjs';
import worker from '../src/index.mjs';
import { HANGOUT_STUN } from '../src/turn-config.mjs';
import { HangoutTurnBudget } from '../src/turn.mjs';

const { createTurnClient } = createRequire(import.meta.url)(productFile('turn-client.js'));
const endpoint = new URL('/turn', 'https://turn-fixture.invalid');
const room = 'a'.repeat(64);
const ttl = 600;
const lifetime = ttl * 1000;
const refreshDelay = 480000;
const generatedIce = () => ({ urls: ['turn:relay.invalid'], username: randomUUID(), credential: randomUUID() });

let client;
beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
});
afterEach(() => {
    client?.stop();
    client = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

async function connect() {
    const bindings = {
        HANGOUT_TURN_ENABLED: '1', HANGOUT_TURN_MONTHLY_GB: '1',
        HANGOUT_TURN_KEY_ID: randomUUID(), HANGOUT_TURN_API_TOKEN: randomUUID(),
        HANGOUT_TURN_ANALYTICS_TOKEN: randomUUID(), HANGOUT_CF_ACCOUNT_ID: randomUUID().replaceAll('-', ''),
        HANGOUT_PREVIEW_KEY: randomUUID(), HANGOUT_HMAC_KEY: randomUUID()
    };
    const storage = new Map();
    const ledger = { get: async key => structuredClone(storage.get(key)),
        put: async (key, value) => { storage.set(key, structuredClone(value)); } };
    const budget = new HangoutTurnBudget({ storage: ledger }, bindings);
    bindings.TURN_BUDGET = {
        idFromName: name => name,
        get: () => ({ fetch: (url, options) => budget.fetch(new Request(url, options)) })
    };
    const mint = vi.fn(() => {
        const ice = generatedIce();
        return Response.json({ iceServers: [{ ...ice, providerKey: bindings.HANGOUT_TURN_KEY_ID }],
            providerAuthorization: bindings.HANGOUT_TURN_API_TOKEN });
    });
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
        if (url.endsWith('/graphql')) return Response.json({ data: { viewer: { accounts: [{ callsTurnUsageAdaptiveGroups: [] }] } } });
        return mint(url, options);
    }));
    const device = await signDevice(newDeviceId(), bindings.HANGOUT_HMAC_KEY);
    const responses = [];
    const fetchFromWorker = vi.fn(async (path, options) => {
        const request = new Request(new URL(path, endpoint), options);
        request.headers.set('Origin', endpoint.origin);
        const response = await worker.fetch(request, { ...bindings, HANGOUT_EXTRA_ORIGINS: endpoint.origin });
        responses.push({ status: response.status, body: await response.clone().json(), cache: response.headers.get('Cache-Control') });
        return response;
    });
    return { bindings, device, mint, fetchFromWorker, responses, storage };
}

function startClient({ bindings, device, fetchFromWorker }, fetchImpl = fetchFromWorker) {
    const onChange = vi.fn(), onStatus = vi.fn();
    client = createTurnClient({ url: endpoint.pathname, preview: bindings.HANGOUT_PREVIEW_KEY, room,
        getDevice: () => device, fetchImpl, onChange, onStatus, setTimer: setTimeout, clearTimer: clearTimeout });
    return { onChange, onStatus };
}

it('passes server-minted short-lived ICE to the browser and keeps provider credentials server-side', async () => {
    const fixture = await connect();
    const { bindings, device, mint, fetchFromWorker, responses, storage } = fixture;
    const { onChange } = startClient(fixture);
    const firstIce = await client.get();

    expect(mint).toHaveBeenCalledTimes(1);
    const [mintUrl, mintRequest] = mint.mock.calls[0];
    expect(new URL(mintUrl).pathname.endsWith(`/keys/${bindings.HANGOUT_TURN_KEY_ID}/credentials/generate-ice-servers`)).toBe(true);
    expect(mintRequest.headers.Authorization === `Bearer ${bindings.HANGOUT_TURN_API_TOKEN}`).toBe(true);
    expect(JSON.parse(mintRequest.body)).toEqual({ ttl });
    expect(fetchFromWorker).toHaveBeenCalledTimes(1);
    const [path, request] = fetchFromWorker.mock.calls[0];
    expect(path).toBe(endpoint.pathname);
    expect(request.method).toBe('POST');
    expect(Object.keys(request.headers)).toEqual(['content-type']);
    const body = JSON.parse(request.body);
    expect(Object.keys(body).sort()).toEqual(['device', 'preview', 'room']);
    expect(body.room).toBe(room);
    expect(body.preview === bindings.HANGOUT_PREVIEW_KEY && body.device === device).toBe(true);

    const [response] = responses;
    expect(response.status).toBe(200);
    expect(response.cache).toBe('no-store');
    expect(Object.keys(response.body).sort()).toEqual(['expiresAt', 'iceServers', 'ttl']);
    expect(response.body.ttl).toBe(ttl);
    expect(response.body.expiresAt).toBe(Date.now() + lifetime);
    expect(response.body.iceServers).toHaveLength(1);
    expect(Object.keys(response.body.iceServers[0]).sort()).toEqual(['credential', 'urls', 'username']);
    expect(firstIce).toEqual(HANGOUT_STUN.concat(response.body.iceServers));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(firstIce);

    const browserData = JSON.stringify([body, response, firstIce, client.status()]);
    for (const value of [bindings.HANGOUT_TURN_KEY_ID, bindings.HANGOUT_TURN_API_TOKEN,
        bindings.HANGOUT_TURN_ANALYTICS_TOKEN, bindings.HANGOUT_HMAC_KEY, bindings.HANGOUT_CF_ACCOUNT_ID]) {
        expect(browserData.includes(value)).toBe(false);
    }
    const saved = JSON.stringify([...storage.values()]);
    expect(saved.includes(response.body.iceServers[0].credential)).toBe(false);
    expect(saved.includes(response.body.iceServers[0].username)).toBe(false);

    const firstExpiry = client.status().expiresAt;
    await vi.advanceTimersByTimeAsync(refreshDelay - 1);
    expect(await client.get()).toEqual(firstIce);
    expect(mint).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchFromWorker).toHaveBeenCalledTimes(2);
    const nextIce = await client.get();
    expect(mint).toHaveBeenCalledTimes(2);
    expect(responses[1].body.expiresAt).toBe(firstExpiry + refreshDelay);
    expect(nextIce).toEqual(HANGOUT_STUN.concat(responses[1].body.iceServers));
    expect(nextIce[1].credential !== firstIce[1].credential).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(nextIce);
});

it.each([0, 1])('rejects a successful Worker response received %i ms after the expiry boundary', async lateBy => {
    const fixture = await connect();
    const { onChange, onStatus } = startClient(fixture, async (...args) => {
        const response = await fixture.fetchFromWorker(...args);
        vi.setSystemTime(fixture.responses[0].body.expiresAt + lateBy);
        return response;
    });

    expect(await client.get()).toEqual(HANGOUT_STUN);
    expect(fixture.responses[0].status).toBe(200);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(HANGOUT_STUN);
    expect(onStatus).toHaveBeenCalledExactlyOnceWith('direct-only');
    expect(client.status().expiresAt).toBe(0);
});

it('uses STUN during an initial outage and automatically retries after sixty seconds', async () => {
    const fixture = await connect();
    const { onStatus } = startClient(fixture);
    fixture.mint.mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect(await client.get()).toEqual(HANGOUT_STUN);
    expect(onStatus).toHaveBeenCalledExactlyOnceWith('direct-only');

    await vi.advanceTimersByTimeAsync(59999);
    expect(await client.get()).toEqual(HANGOUT_STUN);
    expect(fixture.mint).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.fetchFromWorker).toHaveBeenCalledTimes(2);
    const recovered = await client.get();
    expect(fixture.mint).toHaveBeenCalledTimes(2);
    expect(recovered).toEqual(HANGOUT_STUN.concat(fixture.responses[1].body.iceServers));
    expect(onStatus.mock.calls).toEqual([['direct-only'], ['ready']]);
});

it('removes previously issued ICE after a failed refresh', async () => {
    const fixture = await connect();
    const { onChange, onStatus } = startClient(fixture);
    expect(await client.get()).toHaveLength(HANGOUT_STUN.length + 1);
    fixture.mint.mockResolvedValueOnce(new Response(null, { status: 503 }));

    await vi.advanceTimersByTimeAsync(refreshDelay);
    expect(fixture.fetchFromWorker).toHaveBeenCalledTimes(2);
    expect(await client.get()).toEqual(HANGOUT_STUN);
    expect(fixture.responses[1]).toEqual({ status: 503, body: { iceServers: [], reason: 'TURN unavailable' }, cache: 'no-store' });
    expect(onChange).toHaveBeenLastCalledWith(HANGOUT_STUN);
    expect(onStatus.mock.calls).toEqual([['ready'], ['direct-only']]);
    expect(client.status()).toEqual({ expiresAt: 0, retryAt: Date.now() + 60000, pending: false });
});
