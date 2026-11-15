// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
    HANGOUT_STUN,
    buildRuntimeTurnEntries,
    clientIceServersFromEnv,
    hangoutTurnServiceEnabled,
    runtimeTurnConfigured
} from '../src/turn-config.mjs';

const FIXTURE_USER = 'runtime-fixture-user';
const FIXTURE_CRED = 'runtime-fixture-credential-never-commit';
const RELAY = 'turn:relay.example.invalid:3478';

describe('hangout runtime TURN config', () => {
    it('is STUN-only when TURN env vars are unset', () => {
        expect(runtimeTurnConfigured({})).toBe(false);
        expect(hangoutTurnServiceEnabled({})).toBe(false);
        expect(buildRuntimeTurnEntries({})).toBeNull();
        expect(clientIceServersFromEnv({})).toEqual([...HANGOUT_STUN]);
        expect(clientIceServersFromEnv({ HANGOUT_TURN_ENABLED: '0' })).toEqual([...HANGOUT_STUN]);
    });

    it('includes TURN in iceServers when HANGOUT_TURN_URLS and credentials are set', () => {
        const env = {
            HANGOUT_TURN_URLS: `${RELAY},turns:relay.example.invalid:5349`,
            HANGOUT_TURN_USERNAME: FIXTURE_USER,
            HANGOUT_TURN_CREDENTIAL: FIXTURE_CRED
        };
        expect(runtimeTurnConfigured(env)).toBe(true);
        expect(hangoutTurnServiceEnabled(env)).toBe(true);
        const turn = buildRuntimeTurnEntries(env);
        expect(turn).toEqual([{
            urls: [RELAY, 'turns:relay.example.invalid:5349'],
            username: FIXTURE_USER,
            credential: FIXTURE_CRED
        }]);
        const ice = clientIceServersFromEnv(env);
        expect(ice[0]).toEqual(HANGOUT_STUN[0]);
        expect(ice.some((entry) => Array.isArray(entry.urls) && entry.urls.includes(RELAY))).toBe(true);
        expect(ice.find((e) => e.username)?.credential).toBe(FIXTURE_CRED);
    });

    it('rejects relay URLs without username and credential', () => {
        expect(buildRuntimeTurnEntries({ HANGOUT_TURN_URLS: RELAY })).toBeNull();
        expect(clientIceServersFromEnv({ HANGOUT_TURN_URLS: RELAY })).toEqual([...HANGOUT_STUN]);
    });

    it('does not advertise static TURN when URLs are present but credentials are missing', () => {
        const incomplete = [
            { HANGOUT_TURN_URLS: RELAY },
            { HANGOUT_TURN_URLS: RELAY, HANGOUT_TURN_USERNAME: FIXTURE_USER },
            { HANGOUT_TURN_URLS: RELAY, HANGOUT_TURN_CREDENTIAL: FIXTURE_CRED },
            { HANGOUT_TURN_URLS: RELAY, HANGOUT_TURN_USERNAME: '   ', HANGOUT_TURN_CREDENTIAL: FIXTURE_CRED },
            { HANGOUT_TURN_URLS: 'not-a-relay-url', HANGOUT_TURN_USERNAME: FIXTURE_USER, HANGOUT_TURN_CREDENTIAL: FIXTURE_CRED }
        ];
        for (const env of incomplete) {
            expect(runtimeTurnConfigured(env)).toBe(false);
            expect(hangoutTurnServiceEnabled(env)).toBe(false);
        }
        // The explicit Cloudflare TURN switch is independent of the static relay config.
        expect(hangoutTurnServiceEnabled({ HANGOUT_TURN_ENABLED: '1', HANGOUT_TURN_URLS: RELAY })).toBe(true);
        expect(runtimeTurnConfigured({ HANGOUT_TURN_ENABLED: '1', HANGOUT_TURN_URLS: RELAY })).toBe(false);
    });

    it('enables the turn endpoint when only static URLs are configured', () => {
        expect(hangoutTurnServiceEnabled({
            HANGOUT_TURN_URLS: RELAY,
            HANGOUT_TURN_USERNAME: FIXTURE_USER,
            HANGOUT_TURN_CREDENTIAL: FIXTURE_CRED
        })).toBe(true);
        expect(hangoutTurnServiceEnabled({ HANGOUT_TURN_ENABLED: '1' })).toBe(true);
    });
});