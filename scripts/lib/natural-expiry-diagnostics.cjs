'use strict';

// Pure, allowlisted diagnostics. This module performs no IO, browser operations,
// clock reads or application mutations. Callers supply observation receipt times.
const MAX_EVENTS = 12;
const CLOSE_CODES = Object.freeze([1000, 1001, 1005, 1006, 1011, 1012, 1013, 4001, 4003, 4401, 4403, 4429, 4503]);
const COUNT_KEYS = Object.freeze([
    'unlockPosts', 'admittedGuests', 'privateRoomStarts', 'lobbyJoins',
    'privateSockets', 'privateSocketCloses', 'lobbySockets', 'lobbySocketCloses',
    'blockedThirdPartyHttp', 'blockedBrowserMutations', 'pageErrors',
    'expiryHttpChecks', 'expiredTokenReplays', 'logoutAttempts'
]);
const PRIVATE_FLAGS = Object.freeze(['connected', 'ended', 'host', 'captureOff', 'youtubeOff', 'roomHidden']);
const PRIVATE_COUNTS = Object.freeze(['peerCount', 'pcCount', 'productRetries']);
const CONNECTION_STATES = Object.freeze(['offline', 'connecting', 'reconnecting', 'connected']);
const OPEN_CONFIRMATIONS = Object.freeze(['open-event', 'open-at-attachment']);

function integer(value, maximum = 1000000, minimum = 0) {
    return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : null;
}
function boolean(value) { return typeof value === 'boolean' ? value : null; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const child of Object.values(value)) deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}

function createDiagnostics({ startedAtMs, maxElapsedMs }) {
    if (!Number.isSafeInteger(startedAtMs) || startedAtMs < 0 ||
        !Number.isSafeInteger(maxElapsedMs) || maxElapsedMs < 1 ||
        !Number.isSafeInteger(startedAtMs + maxElapsedMs)) {
        throw new TypeError('Invalid diagnostic time bounds');
    }
    const timestamp = (value) => integer(value, startedAtMs + maxElapsedMs, startedAtMs);
    const timing = (when) => ({ atMs: timestamp(object(when).atMs), elapsedMs: integer(object(when).elapsedMs, maxElapsedMs) });
    const pages = {
        private: deepFreeze({ availability: 'not-observed', lastAttempt: null, lastSnapshot: null }),
        lobby: deepFreeze({ availability: 'not-observed', lastAttempt: null, lastSnapshot: null })
    };
    let preCleanup = null;

    function sanitize(kind, input, when) {
        const source = object(input);
        const received = timing(when);
        const closes = (Array.isArray(source.closes) ? source.closes : []).slice(0, MAX_EVENTS)
            .map((value) => object(value))
            .filter((value) => integer(value.generation, MAX_EVENTS, 1) !== null)
            .map((value) => ({ generation: value.generation,
                code: CLOSE_CODES.includes(value.code) ? value.code : null, atMs: timestamp(value.at) }));
        const opens = (Array.isArray(source.opens) ? source.opens : []).slice(0, MAX_EVENTS)
            .map((value) => object(value))
            .filter((value) => integer(value.generation, MAX_EVENTS, 1) !== null && OPEN_CONFIRMATIONS.includes(value.confirmation))
            .map((value) => ({ generation: value.generation, confirmation: value.confirmation,
                observedAtMs: timestamp(value.at) }));
        const value = {
            available: source.available === true,
            receivedAtMs: received.atMs, receivedElapsedMs: received.elapsedMs,
            socketState: integer(source.socketState, 3),
            observedSockets: integer(source.observedSockets, MAX_EVENTS),
            currentSocketGeneration: integer(source.currentSocketGeneration, MAX_EVENTS, 1),
            closes, opens, unknownCloseCodes: integer(source.unknownCloseCodes),
            // Neither native open/close events nor Playwright's public socket
            // event supplies HTTP status. Never infer it from an observed open.
            httpHandshake: { status: null, availability: 'unavailable' }
        };
        if (kind === 'private') {
            for (const key of PRIVATE_FLAGS) value[key] = boolean(source[key]);
            for (const key of PRIVATE_COUNTS) value[key] = integer(source[key]);
        } else {
            value.connection = CONNECTION_STATES.includes(source.connection) ? source.connection : null;
            value.roleIsGuestFan = boolean(source.roleIsGuestFan);
            value.pmCount = integer(source.pmCount);
            value.channelCount = integer(source.channelCount);
        }
        return deepFreeze(value);
    }
    function unavailable(kind, when) {
        if (preCleanup || !Object.hasOwn(pages, kind)) return;
        pages[kind] = deepFreeze({ availability: 'unavailable', lastAttempt: timing(when),
            lastSnapshot: pages[kind].lastSnapshot });
    }
    function record(kind, input, when) {
        if (preCleanup || !Object.hasOwn(pages, kind)) return;
        if (object(input).available !== true) return unavailable(kind, when);
        pages[kind] = deepFreeze({ availability: 'observed', lastAttempt: timing(when),
            lastSnapshot: sanitize(kind, input, when) });
    }
    function freeze(trigger, counts, when) {
        if (preCleanup) return preCleanup;
        const safeCounts = {};
        for (const key of COUNT_KEYS) safeCounts[key] = integer(object(counts)[key]);
        preCleanup = deepFreeze({ kind: 'cached-pre-cleanup',
            trigger: ['failure', 'stop', 'cleanup'].includes(trigger) ? trigger : 'unknown',
            ...timing(when), counts: safeCounts,
            pages: { private: pages.private, lobby: pages.lobby } });
        return preCleanup;
    }
    function read() {
        return deepFreeze({ version: 1, pages: { private: pages.private, lobby: pages.lobby }, preCleanup });
    }
    return Object.freeze({ record, unavailable, freeze, read });
}

module.exports = { createDiagnostics, MAX_EVENTS, CLOSE_CODES };
