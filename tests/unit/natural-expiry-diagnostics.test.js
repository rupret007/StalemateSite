// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createDiagnostics, MAX_EVENTS, CLOSE_CODES } = require('../../scripts/lib/natural-expiry-diagnostics.cjs');
const START = 1_800_000_000_000;
const DURATION = 8 * 60 * 60 * 1000;
const SECRET = 'fixture-sensitive-token-never-retain';
const countKeys = [
    'unlockPosts', 'admittedGuests', 'privateRoomStarts', 'lobbyJoins',
    'privateSockets', 'privateSocketCloses', 'lobbySockets', 'lobbySocketCloses',
    'blockedThirdPartyHttp', 'blockedBrowserMutations', 'pageErrors',
    'expiryHttpChecks', 'expiredTokenReplays', 'logoutAttempts'
];
const when = (elapsedMs = 100) => ({ atMs: START + elapsedMs, elapsedMs });
const create = () => createDiagnostics({ startedAtMs: START, maxElapsedMs: DURATION });
const privateState = overrides => ({
    available: true, socketState: 1, observedSockets: 1, currentSocketGeneration: 1,
    opens: [{ generation: 1, confirmation: 'open-event', at: START + 10 }],
    closes: [], unknownCloseCodes: 0,
    connected: true, ended: false, host: false, captureOff: true,
    youtubeOff: true, roomHidden: false, peerCount: 2, pcCount: 0, productRetries: 0,
    ...overrides
});
const lobbyState = overrides => ({
    available: true, socketState: 0, observedSockets: 1, currentSocketGeneration: 1,
    opens: [], closes: [], unknownCloseCodes: 0,
    connection: 'connecting', roleIsGuestFan: true, pmCount: 0, channelCount: 1,
    ...overrides
});
const snapshot = (cache, kind = 'private') => cache.read().pages[kind].lastSnapshot;
function expectDeepFrozen(value) {
    if (!value || typeof value !== 'object') return;
    expect(Object.isFrozen(value)).toBe(true);
    for (const child of Object.values(value)) expectDeepFrozen(child);
}

describe('natural expiry diagnostic observations', () => {
    it('starts without inventing observations for either page', () => {
        expect(create().read()).toEqual({
            version: 1,
            pages: {
                private: { availability: 'not-observed', lastAttempt: null, lastSnapshot: null },
                lobby: { availability: 'not-observed', lastAttempt: null, lastSnapshot: null }
            },
            preCleanup: null
        });
    });

    it('keeps private and lobby observations independent with their actual receipt times', () => {
        const cache = create();
        cache.record('private', privateState(), when(100));
        cache.record('lobby', lobbyState(), when(200));
        expect(cache.read().pages.private).toMatchObject({
            availability: 'observed', lastAttempt: when(100),
            lastSnapshot: { available: true, receivedAtMs: START + 100, receivedElapsedMs: 100,
                connected: true, peerCount: 2, pcCount: 0, productRetries: 0 }
        });
        expect(cache.read().pages.lobby).toMatchObject({
            availability: 'observed', lastAttempt: when(200),
            lastSnapshot: { available: true, receivedAtMs: START + 200, receivedElapsedMs: 200,
                connection: 'connecting', roleIsGuestFan: true, pmCount: 0, channelCount: 1 }
        });
        expect(snapshot(cache)).not.toHaveProperty('connection');
        expect(snapshot(cache, 'lobby')).not.toHaveProperty('connected');
    });

    it('retains the last good evidence when a later page evaluation is unavailable', () => {
        const cache = create();
        cache.record('private', privateState({ closes: [{ generation: 1, code: CLOSE_CODES[0], at: START + 50 }] }), when());
        const observed = snapshot(cache);
        cache.unavailable('private', when(200));
        expect(cache.read().pages.private).toEqual({
            availability: 'unavailable', lastAttempt: when(200), lastSnapshot: observed
        });
        cache.record('private', { available: false, error: SECRET, connected: false }, when(300));
        expect(cache.read().pages.private).toEqual({
            availability: 'unavailable', lastAttempt: when(300), lastSnapshot: observed
        });
        expect(cache.read().pages.lobby.availability).toBe('not-observed');
        expect(JSON.stringify(cache.read())).not.toContain(SECRET);
    });

    it('does not turn malformed or failed first evaluations into observations', () => {
        for (const state of [null, undefined, false, 42, [], {}, { available: 'true' }, { available: 1 }]) {
            const cache = create();
            cache.record('private', state, when());
            expect(cache.read().pages.private).toEqual({
                availability: 'unavailable', lastAttempt: when(), lastSnapshot: null
            });
        }
        const cache = create();
        cache.unavailable('lobby', when());
        expect(cache.read().pages.lobby).toEqual({
            availability: 'unavailable', lastAttempt: when(), lastSnapshot: null
        });
    });

    it('drops sensitive extra fields from pages, socket events and raw handshake details', () => {
        const cache = create();
        const sensitive = {
            token: SECRET, url: `wss://example.invalid/?token=${SECRET}`, reason: SECRET,
            headers: { Authorization: SECRET }, frames: [SECRET], error: { message: SECRET },
            handshake: { status: 101, availability: 'observed', headers: { Cookie: SECRET } },
            httpHandshake: { status: 403, statusText: SECRET }, receivedAtMs: SECRET
        };
        cache.record('private', privateState({
            ...sensitive,
            closes: [{ generation: 1, code: CLOSE_CODES[0], at: START + 20, ...sensitive }],
            opens: [{ generation: 1, confirmation: 'open-event', at: START + 10, ...sensitive }]
        }), when());
        cache.record('lobby', lobbyState({ ...sensitive, peers: [SECRET], channelNames: [SECRET] }), when());
        const serialized = JSON.stringify(cache.read());
        expect(serialized).not.toContain(SECRET);
        for (const kind of ['private', 'lobby']) {
            const value = snapshot(cache, kind);
            for (const key of ['token', 'url', 'reason', 'headers', 'frames', 'error', 'peers', 'channelNames', 'handshake']) {
                expect(value).not.toHaveProperty(key);
            }
            expect(value.receivedAtMs).toBe(START + 100);
            expect(value.httpHandshake).toEqual({ status: null, availability: 'unavailable' });
        }
        expect(snapshot(cache).closes).toEqual([{ generation: 1, code: CLOSE_CODES[0], atMs: START + 20 }]);
        expect(snapshot(cache).opens).toEqual([{ generation: 1, confirmation: 'open-event', observedAtMs: START + 10 }]);
    });

    it('preserves the difference between an observed open event and an already open socket', () => {
        const cache = create();
        cache.record('private', privateState({
            observedSockets: 3, currentSocketGeneration: 3,
            opens: [
                { generation: 1, confirmation: 'open-event', at: START + 10 },
                { generation: 2, confirmation: 'open-at-attachment', at: START + 20 },
                { generation: 3, confirmation: 'assumed-from-close', at: START + 30 }
            ],
            closes: [{ generation: 3, code: CLOSE_CODES[0], at: START + 40 }]
        }), when());
        expect(snapshot(cache).opens).toEqual([
            { generation: 1, confirmation: 'open-event', observedAtMs: START + 10 },
            { generation: 2, confirmation: 'open-at-attachment', observedAtMs: START + 20 }
        ]);
        expect(snapshot(cache).closes[0].generation).toBe(3);
        expect(snapshot(cache).httpHandshake).toEqual({ status: null, availability: 'unavailable' });
    });

    it('allows only explicit booleans and known lobby connection states', () => {
        const cache = create();
        cache.record('private', privateState({
            connected: 'true', ended: 0, host: {}, captureOff: null, youtubeOff: true, roomHidden: false
        }), when());
        expect(snapshot(cache)).toMatchObject({
            connected: null, ended: null, host: null, captureOff: null, youtubeOff: true, roomHidden: false
        });
        for (const connection of ['offline', 'connecting', 'reconnecting', 'connected']) {
            cache.record('lobby', lobbyState({ connection }), when());
            expect(snapshot(cache, 'lobby').connection).toBe(connection);
        }
        cache.record('lobby', lobbyState({ connection: SECRET, roleIsGuestFan: 'true' }), when());
        expect(snapshot(cache, 'lobby')).toMatchObject({ connection: null, roleIsGuestFan: null });
        expect(JSON.stringify(cache.read())).not.toContain(SECRET);
    });
});

describe('natural expiry diagnostic bounds', () => {
    it('rejects out of range, fractional and nonnumeric counter values without coercion', () => {
        for (const value of [-1, 1_000_001, 0.5, NaN, Infinity, '1', { secret: SECRET }, null]) {
            const cache = create();
            cache.record('private', privateState({ peerCount: value, pcCount: value, productRetries: value, unknownCloseCodes: value }), when());
            cache.record('lobby', lobbyState({ pmCount: value, channelCount: value }), when());
            expect(snapshot(cache)).toMatchObject({ peerCount: null, pcCount: null, productRetries: null, unknownCloseCodes: null });
            expect(snapshot(cache, 'lobby')).toMatchObject({ pmCount: null, channelCount: null });
        }
        const cache = create();
        cache.record('private', privateState({ peerCount: 0, pcCount: 1_000_000, productRetries: 1_000_000 }), when());
        expect(snapshot(cache)).toMatchObject({ peerCount: 0, pcCount: 1_000_000, productRetries: 1_000_000 });
    });

    it('bounds socket states and generations separately from general counters', () => {
        const cache = create();
        for (const socketState of [0, 1, 2, 3]) {
            cache.record('private', privateState({ socketState }), when());
            expect(snapshot(cache).socketState).toBe(socketState);
        }
        for (const value of [-1, 4, 0.5, '1', NaN, Infinity]) {
            cache.record('private', privateState({ socketState: value }), when());
            expect(snapshot(cache).socketState).toBeNull();
        }
        for (const value of [0, MAX_EVENTS]) {
            cache.record('private', privateState({ observedSockets: value }), when());
            expect(snapshot(cache).observedSockets).toBe(value);
        }
        for (const value of [1, MAX_EVENTS]) {
            cache.record('private', privateState({ currentSocketGeneration: value }), when());
            expect(snapshot(cache).currentSocketGeneration).toBe(value);
        }
        for (const value of [-1, MAX_EVENTS + 1, 0.5, '1', NaN, Infinity]) {
            cache.record('private', privateState({ observedSockets: value, currentSocketGeneration: value }), when());
            expect(snapshot(cache)).toMatchObject({ observedSockets: null, currentSocketGeneration: null });
        }
        cache.record('private', privateState({ observedSockets: 0, currentSocketGeneration: 0, opens: [], closes: [] }), when());
        expect(snapshot(cache)).toMatchObject({ observedSockets: 0, currentSocketGeneration: null });
    });

    it('caps retained socket history and excludes malformed generations', () => {
        const cache = create();
        expect(MAX_EVENTS).toBe(12);
        cache.record('private', privateState({
            opens: Array.from({ length: 30 }, (_, index) => ({ generation: index % MAX_EVENTS + 1, confirmation: 'open-event', at: START + index })),
            closes: Array.from({ length: 30 }, (_, index) => ({ generation: index % MAX_EVENTS + 1, code: CLOSE_CODES[0], at: START + index }))
        }), when());
        expect(snapshot(cache).opens).toHaveLength(MAX_EVENTS);
        expect(snapshot(cache).closes).toHaveLength(MAX_EVENTS);
        const generations = [0, -1, MAX_EVENTS + 1, 0.5, '1', null, 1, MAX_EVENTS];
        cache.record('private', privateState({
            opens: generations.map(generation => ({ generation, confirmation: 'open-event', at: START + 10 })),
            closes: generations.map(generation => ({ generation, code: CLOSE_CODES[0], at: START + 20 }))
        }), when());
        expect(snapshot(cache).opens.map(event => event.generation)).toEqual([1, MAX_EVENTS]);
        expect(snapshot(cache).closes.map(event => event.generation)).toEqual([1, MAX_EVENTS]);
        cache.record('private', privateState({ opens: { secret: SECRET }, closes: SECRET }), when());
        expect(snapshot(cache)).toMatchObject({ opens: [], closes: [] });
    });

    it('preserves allowlisted close codes and uses null for unknown codes', () => {
        const cache = create();
        for (const code of CLOSE_CODES) {
            cache.record('private', privateState({ closes: [{ generation: 1, code, at: START + 20 }] }), when());
            expect(snapshot(cache).closes[0].code).toBe(code);
        }
        for (const code of [999_999, '1000', SECRET, null, { reason: SECRET }, NaN]) {
            cache.record('private', privateState({ closes: [{ generation: 1, code, at: START + 20 }] }), when());
            expect(snapshot(cache).closes[0].code).toBeNull();
            expect(JSON.stringify(cache.read())).not.toContain(SECRET);
        }
    });

    it('retains only event and receipt times within the observer window', () => {
        const cache = create();
        cache.record('private', privateState({
            opens: [{ generation: 1, confirmation: 'open-event', at: START }],
            closes: [{ generation: 1, code: CLOSE_CODES[0], at: START + DURATION }]
        }), when(DURATION));
        expect(snapshot(cache)).toMatchObject({ receivedAtMs: START + DURATION, receivedElapsedMs: DURATION });
        expect(snapshot(cache).opens[0].observedAtMs).toBe(START);
        expect(snapshot(cache).closes[0].atMs).toBe(START + DURATION);
        for (const at of [START - 1, START + DURATION + 1, NaN, Infinity, String(START), SECRET]) {
            cache.record('private', privateState({
                opens: [{ generation: 1, confirmation: 'open-event', at }],
                closes: [{ generation: 1, code: CLOSE_CODES[0], at }]
            }), { atMs: at, elapsedMs: DURATION + 1 });
            const value = snapshot(cache);
            expect(value.receivedAtMs).toBeNull();
            expect(value.receivedElapsedMs).toBeNull();
            expect(cache.read().pages.private.lastAttempt).toEqual({ atMs: null, elapsedMs: null });
            for (const event of value.opens) expect(event.observedAtMs).toBeNull();
            for (const event of value.closes) expect(event.atMs).toBeNull();
        }
    });
});

describe('immutable pre-cleanup natural expiry evidence', () => {
    it('isolates cached evidence from mutations to both input and read results', () => {
        const cache = create();
        const input = privateState({ closes: [{ generation: 1, code: CLOSE_CODES[0], at: START + 20 }] });
        const receipt = when();
        cache.record('private', input, receipt);
        input.connected = false;
        input.opens[0].confirmation = SECRET;
        input.closes[0].code = 999_999;
        receipt.atMs = 0;
        const read = cache.read();
        Reflect.set(read.pages.private.lastSnapshot, 'connected', false);
        Reflect.set(read.pages.private.lastSnapshot.opens[0], 'confirmation', SECRET);
        Reflect.set(read.pages.private.lastAttempt, 'atMs', 0);
        Reflect.set(read.pages, 'private', { secret: SECRET });
        expect(cache.read().pages.private).toMatchObject({ lastAttempt: when(), lastSnapshot: {
            connected: true,
            opens: [{ generation: 1, confirmation: 'open-event', observedAtMs: START + 10 }],
            closes: [{ generation: 1, code: CLOSE_CODES[0], atMs: START + 20 }]
        } });
    });

    it('keeps an observation made before a failed assertion available in the failure receipt', () => {
        const cache = create();
        let frozen;
        try {
            cache.record('private', privateState({
                observedSockets: 7, currentSocketGeneration: 7,
                closes: [{ generation: 6, code: CLOSE_CODES[0], at: START + 90 }]
            }), when());
            if (snapshot(cache).observedSockets > 6) throw new Error('socket-budget-exceeded');
        } catch {
            cache.unavailable('private', when(110));
            frozen = cache.freeze('failure', { privateSockets: 7, privateSocketCloses: 6 }, when(120));
        }
        expect(frozen).toMatchObject({
            kind: 'cached-pre-cleanup', trigger: 'failure', atMs: START + 120, elapsedMs: 120,
            counts: { privateSockets: 7, privateSocketCloses: 6 },
            pages: { private: { availability: 'unavailable', lastAttempt: when(110), lastSnapshot: {
                receivedAtMs: START + 100, observedSockets: 7,
                closes: [{ generation: 6, code: CLOSE_CODES[0], atMs: START + 90 }]
            } } }
        });
        expect(cache.read().preCleanup).toEqual(frozen);
    });

    it.each(['failure', 'stop', 'cleanup'])('freezes %s evidence once before cleanup can change it', trigger => {
        const cache = create();
        cache.record('private', privateState(), when());
        cache.record('lobby', lobbyState(), when(110));
        const counts = Object.fromEntries(countKeys.map((key, index) => [key, index]));
        counts.url = SECRET;
        counts.headers = { Authorization: SECRET };
        const frozen = cache.freeze(trigger, counts, when(120));
        const original = JSON.stringify(cache.read());
        expect(frozen).toMatchObject({ kind: 'cached-pre-cleanup', trigger, atMs: START + 120, elapsedMs: 120 });
        expect(frozen.counts).toEqual(Object.fromEntries(countKeys.map((key, index) => [key, index])));
        expectDeepFrozen(frozen);
        expect(JSON.stringify(frozen)).not.toContain(SECRET);
        counts.privateSocketCloses = 99;
        Reflect.set(frozen.counts, 'privateSocketCloses', 99);
        Reflect.set(frozen.pages.private.lastSnapshot.opens[0], 'confirmation', SECRET);
        cache.record('private', privateState({ ended: true, socketState: 3 }), when(200));
        cache.unavailable('lobby', when(210));
        const repeated = cache.freeze('cleanup', { privateSocketCloses: 99, logoutAttempts: 1 }, when(220));
        expect(repeated).toEqual(frozen);
        expect(JSON.stringify(cache.read())).toBe(original);
    });

    it('does not preserve unbounded or raw values in frozen counts and timestamps', () => {
        const cache = create();
        const frozen = cache.freeze('stop', {
            unlockPosts: -1, admittedGuests: 1_000_001, privateRoomStarts: '1', lobbyJoins: Infinity,
            privateSockets: 0.5, privateSocketCloses: { secret: SECRET }, lobbySockets: NaN,
            lobbySocketCloses: 0, blockedThirdPartyHttp: 1_000_000, unknownCounter: SECRET
        }, { atMs: START - 1, elapsedMs: -1 });
        expect(frozen).toMatchObject({ atMs: null, elapsedMs: null, counts: {
            unlockPosts: null, admittedGuests: null, privateRoomStarts: null, lobbyJoins: null,
            privateSockets: null, privateSocketCloses: null, lobbySockets: null,
            lobbySocketCloses: 0, blockedThirdPartyHttp: 1_000_000
        } });
        expect(Object.keys(frozen.counts).sort()).toEqual([...countKeys].sort());
        expect(JSON.stringify(frozen)).not.toContain(SECRET);
    });
});
