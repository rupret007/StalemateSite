// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { ACTIVITY, describeRooms, summarizeLobby, isMention } = require('../../r/45662413410ed051/lobby/discovery-core.js');
const room = (name, overrides = {}) => ({ name, kind: 'art', title: 'Drawing room', count: 1, max: 8, locked: false, key: false, cams: true, ...overrides });
const visitor = (nick, overrides = {}) => ({ nick, away: false, band: false, ...overrides });

describe('room discovery', () => {
    it('puts joined rooms first, then occupied public rooms, empty rooms, and restrictions, with names breaking ties', () => {
        const result = describeRooms([
            room('#art-zebra'),
            room('#art-full', { count: 8 }),
            room('#art-empty', { count: 0 }),
            room('#art-key', { key: true }),
            room('#art-mine', { count: 8, locked: true, key: true }),
            room('#art-alpha'),
            room('#art-locked', { locked: true })
        ], ['#ART-MINE']);
        expect(result.map((r) => r.name)).toEqual(['#art-mine', '#art-alpha', '#art-zebra', '#art-empty', '#art-full', '#art-key', '#art-locked']);
        expect(result[0]).toMatchObject({ state: 'joined', canJoin: true, actionLabel: 'Return to room' });
        expect(result[3]).toMatchObject({ state: 'empty', statusLabel: 'No one here yet' });
    });

    it('honors capacity without hiding a joined room or understating over-capacity counts', () => {
        expect(describeRooms([room('#art-full', { count: 9, max: 8 })])[0]).toMatchObject({ count: 9, max: 8, state: 'full', canJoin: false });
        expect(describeRooms([room('#art-full', { count: 9, max: 8 })], new Set(['#art-full']))[0]).toMatchObject({ state: 'joined', canJoin: true });
        expect(describeRooms([room('#art-small', { count: 1, max: 2 })])[0]).toMatchObject({ state: 'open', canJoin: true });
    });

    it('keeps invite and key restrictions explicit without pretending to know private invitation membership', () => {
        const [invite] = describeRooms([room('#art-invite', { locked: true, invited: true, secret: 'do not publish' })]);
        expect(invite).toMatchObject({ state: 'invite', statusLabel: 'Invite-only or locked', actionLabel: 'Try joining', canJoin: true });
        expect(invite).not.toHaveProperty('invited');
        expect(invite).not.toHaveProperty('secret');
        expect(describeRooms([room('#art-key', { key: true })])[0]).toMatchObject({ state: 'key', statusLabel: 'Key required', actionLabel: 'Enter room key' });
    });

    it('does not turn malformed directory records into imaginary empty or open rooms', () => {
        expect(describeRooms(null)).toEqual([]);
        const malformed = [null, 12, {}, room('bad name'), room('#art-nan', { count: NaN }), room('#art-negative', { count: -1 }), room('#art-fraction', { count: 1.5 }), room('#art-string', { count: '1' }), room('#art-cap', { max: 0 }), room('#art-infinity', { max: Infinity }), room('#art-kind', { kind: '__proto__' }), room('#art-kind-object', { kind: { toString: null } }), room('#art-lock', { locked: 'false' }), room('#art-secret', { key: 'secret' })];
        expect(describeRooms(malformed)).toEqual([]);
        expect(describeRooms([room('#art-one'), room('#ART-ONE')])).toHaveLength(1);
    });

    it('copies public fields without changing the source or treating titles as markup', () => {
        const source = Object.freeze(room('#art-copy', { title: '<img src=x onerror=alert(1)>', unrelated: { token: 'private' } }));
        const input = Object.freeze([source]);
        const [copy] = describeRooms(input, Object.freeze([]));
        expect(copy).not.toBe(source);
        expect(copy.title).toBe(source.title);
        expect(copy).not.toHaveProperty('unrelated');
        expect(source).not.toHaveProperty('state');
        expect(ACTIVITY.art.label).toBe('Draw together');
        expect(ACTIVITY.art.description).toMatch(/Camera optional/);
        expect(ACTIVITY.jam.description).toMatch(/needs a host/);
    });
});

describe('honest lobby presence', () => {
    it('offers a useful quiet state without inventing conversation, band presence, or other visitors', () => {
        const summary = summarizeLobby({ count: 150, names: [visitor('MeHere')] }, 'mehere');
        expect(summary).toMatchObject({ others: 0, available: 0, band: 0 });
        expect(summary.headline).toMatch(/quiet/);
        expect(summary.detail).toMatch(/start a room/);
        expect(summary.detail).not.toMatch(/active|talking now|band is here/);
    });

    it('counts named visitors, excluding self and duplicates; not-away is not speaking activity', () => {
        const names = Object.freeze([
            Object.freeze(visitor('MeHere', { band: true })),
            Object.freeze(visitor('Alpha', { band: true })),
            Object.freeze(visitor('AwayFan', { away: true })),
            Object.freeze(visitor('alpha')),
            null,
            { nick: 'invalid nick', band: true },
            { nick: 'UnknownStatus', band: 'true' }
        ]);
        const summary = summarizeLobby({ names, count: 99 }, 'MEHERE');
        expect(summary).toMatchObject({ others: 3, available: 1, band: 1 });
        expect(summary.detail).toMatch(/1 not marked away/);
        expect(summary.detail).toMatch(/Presence does not mean someone is reading or talking/);
    });

    it('distinguishes an unavailable people list from an empty lobby', () => {
        expect(summarizeLobby(null, 'MeHere')).toMatchObject({ others: 0, headline: 'Waiting for the lobby' });
        expect(summarizeLobby({ names: 42, count: 20 }, null)).toMatchObject({ others: 0, available: 0, band: 0 });
        expect(summarizeLobby({ names: [visitor('AwayFan', { away: true })] }, 'MeHere').detail).toMatch(/^0 not marked away/);
    });
});

describe('IRC nickname mentions', () => {
    it('matches whole case-insensitive nicknames at chat punctuation boundaries', () => {
        for (const message of ['ALPHA: hello', 'hello, Alpha!', '@Alpha', '(alpha)', 'alphabet first, Alpha later']) expect(isMention(message, 'Alpha'), message).toBe(true);
        for (const message of ['Alphabet', 'NotAlpha', 'Alpha2', 'xAlpha', 'hello everyone']) expect(isMention(message, 'Alpha'), message).toBe(false);
    });

    it('treats every allowed IRC nickname character as part of a nickname, including regex metacharacters', () => {
        for (const character of '[]{}^`|_-') {
            expect(isMention(`Hello Alpha${character}`, 'Alpha'), character).toBe(false);
            expect(isMention(`Hello ${character}Alpha`, 'Alpha'), character).toBe(false);
            expect(isMention(`Hello Alpha${character}!`, `Alpha${character}`), character).toBe(true);
        }
        expect(isMention('hello aLPHa[one]!', 'Alpha[one]')).toBe(true);
        expect(isMention('hello Alpha{one}!', 'Alpha[one]')).toBe(false);
        expect(isMention('hello Alpha~!', 'Alpha^')).toBe(false);
        expect(isMention('anything', '')).toBe(false);
        expect(isMention(null, 'Alpha')).toBe(false);
        expect(isMention('alpha', ['Alpha'])).toBe(false);
    });
});

it('loads as a standalone browser script without CommonJS or browser side effects', () => {
    const source = readFileSync(new URL('../../r/45662413410ed051/lobby/discovery-core.js', import.meta.url), 'utf8');
    const sandbox = { window: {} };
    vm.runInNewContext(source, sandbox);
    expect(Object.keys(sandbox.window)).toEqual(['HangoutDiscovery']);
    expect(sandbox.window.HangoutDiscovery.isMention('hello Alpha!', 'Alpha')).toBe(true);
    expect(sandbox.window.HangoutDiscovery.describeRooms([])).toEqual([]);
});
