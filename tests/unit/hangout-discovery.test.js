// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { ACTIVITY, QUIET_PROMPT, describeRooms, summarizeLobby, isMention, describeVisit, visitView, calendarReminder, icsText } = require('../../r/45662413410ed051/lobby/discovery-core.js');
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
    expect(source).not.toMatch(/Date\.now|localStorage|fetch\(|WebSocket|document\./);
    const sandbox = { window: {}, Intl };
    vm.runInNewContext(source, sandbox);
    expect(Object.keys(sandbox.window)).toEqual(['HangoutDiscovery']);
    expect(sandbox.window.HangoutDiscovery.isMention('hello Alpha!', 'Alpha')).toBe(true);
    expect(sandbox.window.HangoutDiscovery.describeRooms([])).toEqual([]);
    const offline = sandbox.window.HangoutDiscovery.describeVisit({ connection: 'offline', channel: { names: [] }, gathering: { confirmed: true } });
    expect(offline.headline).not.toMatch(/quiet/);
    expect(offline.gathering).toBeNull();
});

const NOW = 1800000000000;
const START = NOW + 60 * 60 * 1000;
const END = START + 60 * 60 * 1000;
const formatAt = (instant, timeZone) => new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone
}).format(new Date(instant));
const confirmed = (overrides = {}) => Object.freeze({
    confirmed: true, host: 'QuietHost', startsAt: START, endsAt: END, activity: 'write', recurrence: false, ...overrides
});
const visit = (overrides = {}) => describeVisit({
    connection: 'connected', channel: { names: [visitor('MeHere')] }, me: 'MeHere', now: NOW, timeZone: 'UTC', ...overrides
});

describe('quiet visits and confirmed gatherings', () => {
    it('shows a supplied host, local time, and equipment-free activity without attendance or authority', () => {
        const source = confirmed({ email: 'host@example.invalid', moderator: true, attendees: 8, band: true, rsvp: true });
        const result = visit({ gathering: source, channel: { count: 40, names: [visitor('MeHere'), visitor('QuietHost', { band: true })] } });
        expect(result.gatheringStatus).toBe('confirmed');
        expect(result.quiet).toBe(false);
        expect(result.quietPrompt).toBeNull();
        expect(result.creation).toBeNull();
        expect(result.gathering).toMatchObject({
            host: 'QuietHost', activity: 'write', timing: 'Upcoming', timeZone: 'UTC', timeZoneAssumed: false,
            localStart: formatAt(START, 'UTC'), localEnd: formatAt(END, 'UTC')
        });
        expect(result.gathering.localStart).not.toBe(formatAt(START, 'Pacific/Kiritimati'));
        expect(result.gathering).not.toHaveProperty('moderator');
        expect(result.gathering).not.toHaveProperty('attendees');
        expect(result.gathering).not.toHaveProperty('hostPresent');
        expect(result.gathering.note).toMatch(/does not make QuietHost a site moderator/);
        expect(result.gathering.note).toMatch(/not proof that person is in the room/);
        expect(result.gathering.note).toMatch(/not an RSVP/);
        expect(result.gathering.note).toMatch(/not a weekly commitment/);
        expect(result.gathering.note).not.toMatch(/is here|host is online|band member present/);
        expect(source).not.toHaveProperty('state');
        const view = visitView(result);
        expect(view).toMatchObject({
            showGathering: true, showSave: true, showQuietPrompt: false, showCreation: false,
            gatheringHeading: 'Next confirmed gathering', gatheringHost: 'Host: QuietHost'
        });
        expect(view.gatheringWhen).toContain(result.gathering.localStart);
        expect(view.gatheringWhen).not.toContain('shown in UTC');
        expect(view.gatheringActivity).toMatch(/Nothing to install/);
    });

    it('keeps an in-progress gathering and rejects incomplete, band-gated, recurring, equipped, or unbounded records', () => {
        expect(visit({ gathering: confirmed({ startsAt: NOW - 60 * 1000, endsAt: NOW - 60 * 1000 + 15 * 60 * 1000 }) }).gathering.timing).toBe('Happening now');
        const rejected = [
            null, 'Friday at 8', [], confirmed({ confirmed: 'true' }), confirmed({ host: 'no' }),
            confirmed({ activity: 'jam' }), confirmed({ requiresBand: true }), confirmed({ recurrence: 'weekly' }),
            confirmed({ recurrence: { freq: 'WEEKLY' } }), confirmed({ startsAt: NOW - 60 * 1000, endsAt: NOW }),
            confirmed({ endsAt: START + 15 * 60 * 1000 - 1 }), confirmed({ endsAt: START + 4 * 60 * 60 * 1000 + 1 }),
            confirmed({ startsAt: NOW + 14 * 24 * 60 * 60 * 1000 + 1, endsAt: NOW + 14 * 24 * 60 * 60 * 1000 + 1 + 15 * 60 * 1000 }),
            confirmed({ startsAt: 1.5, endsAt: END })
        ];
        for (const gathering of rejected) {
            const result = visit({ gathering });
            expect(result.gatheringStatus, JSON.stringify(gathering)).toBe('none');
            expect(result.gathering).toBeNull();
        }
        const earliest = visit({
            gathering: [
                confirmed({ host: 'LaterOne', startsAt: START + 2 * 60 * 60 * 1000, endsAt: START + 3 * 60 * 60 * 1000 }),
                confirmed({ confirmed: false, startsAt: START - 60 * 60 * 1000, endsAt: START }),
                confirmed({ host: 'HostB' }),
                confirmed({ host: 'hosta' })
            ]
        });
        expect(earliest.gathering.host).toBe('hosta');
        const edge = visit({ gathering: confirmed({ startsAt: NOW + 14 * 24 * 60 * 60 * 1000, endsAt: NOW + 14 * 24 * 60 * 60 * 1000 + 15 * 60 * 1000 }) });
        expect(edge.gatheringStatus).toBe('confirmed');
    });

    it('offers a quiet prompt and an approved past creation only when the room is actually quiet', () => {
        const past = Object.freeze({ approved: true, title: 'Paper birds <ink>', detail: 'A shared drawing.', room: '#art-birds', url: 'https://example.invalid/secret' });
        const quiet = visit({ creation: past });
        expect(quiet.quiet).toBe(true);
        expect(quiet.headline).toMatch(/quiet/);
        expect(quiet.welcomeTitle).toMatch(/First one here/);
        expect(quiet.detail).toMatch(/start a room/);
        expect(quiet.detail).toMatch(/No confirmed gathering was supplied/);
        expect(quiet.detail).not.toMatch(/active|talking now|band is here/);
        expect(quiet.quietPrompt).toEqual(QUIET_PROMPT);
        expect(quiet.creation).toEqual({ title: 'Paper birds <ink>', detail: 'A shared drawing.', room: '#art-birds' });
        expect(quiet.creation).not.toHaveProperty('url');
        const view = visitView(quiet);
        expect(view.showQuietPrompt).toBe(true);
        expect(view.quietPromptDraft).toBe(QUIET_PROMPT.draft);
        expect(view.creationTitle).toBe('Paper birds <ink>');
        expect(view.creationDetail).toBe('A shared drawing. It was made in #art-birds.');
        expect(view.gatheringActivity).toMatch(/does not invent a time/);
        expect(view.gatheringActivity).toMatch(/does not require a band member/);
        expect(visit({ creation: { approved: false, title: 'Nope', detail: 'Hidden.' } }).creation).toBeNull();
        expect(visit({ creation: { approved: true, title: 'Bad\nline', detail: 'Hidden.' } }).creation).toBeNull();
        expect(visit({ creation: { approved: true, title: 'Named', detail: 'Hidden.', room: 'art' } }).creation).toBeNull();
        expect(visitView(visit({ creation: null })).creationMissing).toMatch(/No approved past creation was supplied/);
        const busy = visit({ channel: { names: [visitor('MeHere'), visitor('Alpha')] }, creation: past, gathering: confirmed() });
        expect(busy.quiet).toBe(false);
        expect(busy.creation).toBeNull();
        expect(busy.quietPrompt).toBeNull();
        expect(busy.gathering.host).toBe('QuietHost');
        expect(visitView(busy).showCreation).toBe(false);
    });

    it('explains a disconnected service instead of calling the room empty or stale-confirming a gathering', () => {
        const gathering = confirmed();
        const creation = { approved: true, title: 'Paper birds', detail: 'A shared drawing.' };
        for (const connection of ['offline', 'reconnecting', 'connecting', 'ended', 'weird']) {
            const result = describeVisit({ connection, channel: { names: [] }, me: 'MeHere', gathering, creation, now: NOW, timeZone: 'UTC' });
            expect(result.quiet, connection).toBe(false);
            expect(result.headline, connection).not.toMatch(/quiet|First one here/);
            expect(result.gatheringStatus, connection).toBe('unavailable');
            expect(result.gathering, connection).toBeNull();
            expect(result.creation, connection).toBeNull();
            expect(result.quietPrompt, connection).toBeNull();
            expect(result.detail, connection).not.toMatch(/No confirmed gathering was supplied/);
            expect(visitView(result).showGathering, connection).toBe(false);
        }
        expect(describeVisit({ connection: 'offline' }).detail).toMatch(/not an empty room/);
        expect(describeVisit({ connection: 'reconnecting' }).detail).toMatch(/not proof the room is empty/);
        expect(describeVisit({ connection: 'connecting' }).detail).toMatch(/has not answered/);
        expect(describeVisit({ connection: 'ended' }).headline).toMatch(/session has ended/);
        expect(describeVisit({ connection: 'connected', now: NOW, timeZone: 'UTC' }).welcomeTitle).toBe('Waiting for the lobby');
        expect(describeVisit({ connection: 'connected', channel: { names: [visitor('MeHere')] }, me: 'MeHere', gathering: confirmed(), timeZone: 'UTC' }).gatheringStatus).toBe('unavailable');
    });

    it('writes a local calendar reminder without an RSVP, recurrence, or attendee', () => {
        const shown = visit({ gathering: confirmed({ activity: 'chat', note: 'ATTENDEE:mailto:person@example.invalid' }) }).gathering;
        const ics = calendarReminder(shown, NOW);
        expect(new Date(START).toISOString()).toBe('2027-01-15T09:00:00.000Z');
        expect(ics).toContain('DTSTART:20270115T090000Z');
        expect(ics).toContain('DTEND:20270115T100000Z');
        expect(ics).toContain('DTSTAMP:20270115T080000Z');
        expect(ics).toContain('UID:hangout-quiethost-');
        expect(ics).toContain('@hangout.invalid');
        const logical = ics.replace(/\r\n[ \t]/g, '');
        expect(logical).toContain('DESCRIPTION:Local reminder only.');
        expect(logical).toContain('This file is not an RSVP and does not record attendance.');
        expect(logical).toContain('A camera\\, microphone');
        expect(logical).toContain('SUMMARY:Hang Out with QuietHost: text chat');
        expect(logical).not.toContain('\\:');
        expect(logical).not.toContain('ATTENDEE');
        expect(logical).not.toContain('RRULE');
        expect(logical).not.toContain('ORGANIZER');
        expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
        for (const line of ics.split('\r\n')) {
            if (!line) continue;
            expect(line.length).toBeLessThanOrEqual(75);
            expect(line.endsWith('\\')).toBe(false);
        }
        expect(calendarReminder({ ...shown, activityLabel: 'Bring a microphone' }, NOW)).toBe('');
        expect(calendarReminder({ ...shown, endsAt: shown.startsAt + 1000 }, NOW)).toBe('');
        const assumed = visit({ gathering: confirmed(), timeZone: 'Not/AZone' });
        expect(assumed.gathering.timeZoneAssumed).toBe(true);
        expect(assumed.gathering.localStart).toBe(formatAt(START, 'UTC'));
        expect(visitView(assumed).gatheringWhen).toContain('shown in UTC');
    });

    it('escapes RFC 5545 TEXT and leaves a colon literal', () => {
        expect(icsText('a\\b')).toBe('a\\\\b');
        expect(icsText('room;one')).toBe('room\\;one');
        expect(icsText('a,b')).toBe('a\\,b');
        expect(icsText('a\nb')).toBe('a\\nb');
        expect(icsText('a\rb')).toBe('a\\nb');
        expect(icsText('a\r\nb')).toBe('a\\nb');
        expect(icsText('a\r\n\nb')).toBe('a\\n\\nb');
        expect(icsText('Meet: 1')).toBe('Meet: 1');
        expect(icsText('\\:colon')).toBe('\\\\:colon');
        expect(icsText('a\\,;:\r\n')).toBe('a\\\\\\,\\;:\\n');
        const mixed = icsText('x\r\ny,z;w\\q: colon');
        expect(mixed).toBe('x\\ny\\,z\\;w\\\\q: colon');
        expect(mixed).not.toMatch(/[\r\n]/);
    });
});
