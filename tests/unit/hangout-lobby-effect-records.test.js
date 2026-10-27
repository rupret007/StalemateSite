// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';
import { createDurableRecordStorage } from '../../hangout-worker/src/durable-record-storage.mjs';
import { initializeLobbyEffects, writeLobbyEffects, readLobbyState, pruneLobbyEffectLogs, LOBBY_EFFECT_MARKER, LOBBY_LOG_INDEX, LOBBY_LOG_PREFIX } from '../../hangout-worker/src/lobby-effect-records.mjs';
import { LOG_TTL } from '../../hangout-worker/src/community-state.mjs';
import { openDurableRecordSqlite } from '../support/durable-record-sqlite.mjs';
const NOW = 1800000000000, cleanups = [];
const hashRows = driver => createHash('sha256').update(JSON.stringify([...driver.rows()].map(([key, value]) => [key, value instanceof Uint8Array ? Buffer.from(value).toString('base64') : value]))).digest('hex');
afterEach(async () => { for (const item of cleanups.splice(0)) { for (const driver of item.drivers) await driver.close(); await rm(item.directory, { recursive: true, force: true }); } });
async function fixture({ logs = [], initialize = true } = {}) {
    let at = NOW;
    const directory = await mkdtemp(join(tmpdir(), 'lobby-effect-records-')), filename = join(directory, 'lobby.sqlite'), hooks = {};
    const driver = openDurableRecordSqlite(filename, hooks), cleanup = { directory, drivers: [driver] }; cleanups.push(cleanup);
    const wrap = raw => createDurableRecordStorage({ storage: raw, namespace: 'lobby-effects-test', maxRecordBytes: 8 * 1024 * 1024 });
    const storage = wrap(driver), engine = createLobby({ now: () => NOW });
    const initial = { net: engine.snapshot(), rooms: engine.roomSnapshot(), abuse: engine.abuseSnapshot(), sessions: engine.sessionSnapshot(),
        moderationQueue: { reports: [], held: [] }, aiReviews: [], modlog: logs };
    if (initialize) await storage.transaction(tx => initializeLobbyEffects({ tx, now: NOW, state: initial }));
    return { driver, hooks, storage, initial,
        write: (effects, options = {}) => storage.transaction(tx => writeLobbyEffects({ tx, effects, now: at, ...options })),
        read: () => storage.transaction(tx => readLobbyState({ tx, now: at })), advance: amount => { at += amount; },
        async reopen() { await driver.close(); const next = openDurableRecordSqlite(filename); cleanup.drivers.push(next); return { driver: next, storage: wrap(next) }; } };
}
const log = (n, at = NOW) => ({ at, by: 'TestOwner', action: 'room-register', target: `#test-${n}`, reason: '', ch: '#stalemate' });
describe('known lobby effects in one physical-record transaction', () => {
    it('requires explicit known-new initialization and refuses missing or overwritten initialized state', async () => {
        const f = await fixture({ initialize: false });
        await expect(f.read()).rejects.toThrow('lobby-effects-unavailable');
        await expect(f.write([])).rejects.toThrow('lobby-effects-unavailable');
        await f.storage.transaction(tx => initializeLobbyEffects({ tx, now: NOW, state: f.initial }));
        expect(await f.read()).toEqual(f.initial);
        await expect(f.storage.transaction(tx => initializeLobbyEffects({ tx, now: NOW, state: f.initial }))).rejects.toThrow();
        await f.storage.transaction(tx => tx.delete('moderation-queue'));
        await expect(f.read()).rejects.toThrow();
    });
    it.each(['rooms', 'room-index', 'log:000000000000001:old-writer', 'community-room:#orphan'])('refuses provisioning over existing %s data', async key => {
        const f = await fixture({ initialize: false }); await f.storage.transaction(tx => tx.put(key, {}));
        const before = hashRows(f.driver);
        await expect(f.storage.transaction(tx => initializeLobbyEffects({ tx, now: NOW, state: f.initial }))).rejects.toThrow();
        expect(hashRows(f.driver)).toBe(before);
    });
    it.each(['say', 'chat', 'pm', 'unknown'])('rejects unknown %s effects and rolls back earlier legitimate writes', async kind => {
        const f = await fixture(), before = hashRows(f.driver);
        await expect(f.write([['net', { ...f.initial.net, lock: 'readonly' }], [kind, { text: 'never persist an ordinary body' }]])).rejects.toThrow();
        expect(hashRows(f.driver)).toBe(before);
    });
    it.each(['rooms', 'moderation-queue', 'ai-reviews', 'modlog'])('does not admit %s through costsOnly', async kind => {
        const f = await fixture(), value = { rooms: f.initial.rooms, 'moderation-queue': f.initial.moderationQueue, 'ai-reviews': [], modlog: log(1) }[kind];
        await expect(f.write([[kind, value]], { costsOnly: true })).rejects.toThrow();
    });
    it('persists exact known envelopes, including fractional budget costs and optional device allowance fields', async () => {
        const f = await fixture(), abuse = { version: 1, buckets: [['chat:dev:test', { tokens: 1.5, at: NOW }]], devices: [['device_test', { lastRoom: NOW }]], ips: [] };
        await f.write([['abuse', abuse], ['sessions', f.initial.sessions], ['net', { ...f.initial.net, budget: { day: '2026-10-25', requests: 0.05 } }]], { costsOnly: true });
        const restored = await f.read(); expect(restored.abuse).toEqual(abuse); expect(restored.net.budget.requests).toBe(0.05);
    });
    it('does not read or change log records for costs-only or ordinary non-log snapshots', async () => {
        const f = await fixture({ logs: [log(1, NOW - LOG_TTL + 1)] }); f.advance(2); f.driver.resetOperations();
        await f.write([['net', f.initial.net]], { costsOnly: true });
        await f.write([['net', f.initial.net]]);
        expect(f.driver.stats.operations.some(event => event.key.includes(Buffer.from(LOBBY_LOG_PREFIX).toString('hex'))
            || event.key.includes(Buffer.from(LOBBY_LOG_INDEX).toString('hex')))).toBe(false);
        expect((await f.storage.transaction(tx => tx.get(LOBBY_LOG_INDEX))).segments).toHaveLength(1);
        await f.storage.transaction(tx => pruneLobbyEffectLogs({ tx, now: NOW + 2 }));
        expect((await f.storage.transaction(tx => tx.get(LOBBY_LOG_INDEX)))).toMatchObject({ next: 1, segments: [] });
    });
    it('preserves original log timestamps through clock corrections and never stores expired additions', async () => {
        const future = log(1, NOW + 60000), f = await fixture({ logs: [future, log(2, NOW - LOG_TTL)] });
        expect((await f.read()).modlog).toEqual([future]);
        f.advance(-1000);
        await f.storage.transaction(tx => pruneLobbyEffectLogs({ tx, now: NOW - 1000 }));
        expect((await f.read()).modlog).toEqual([future]);
        expect((await f.storage.transaction(tx => tx.get(LOBBY_LOG_INDEX))).next).toBe(2);
    });
    it.each(['net', 'abuse', 'sessions', 'moderation-queue'])('rejects an ordinary body added to the %s snapshot', async kind => {
        const f = await fixture(), value = { ...{ net: f.initial.net, abuse: f.initial.abuse, sessions: f.initial.sessions, 'moderation-queue': f.initial.moderationQueue }[kind], text: 'arbitrary retained body' };
        await expect(f.write([[kind, value]])).rejects.toThrow();
    });
    it.each(['net', 'abuse', 'sessions', 'moderation-queue', 'ai-reviews'])('refuses ordinary replacement of corrupt initialized %s data', async kind => {
        const f = await fixture(), value = { net: f.initial.net, abuse: f.initial.abuse, sessions: f.initial.sessions,
            'moderation-queue': f.initial.moderationQueue, 'ai-reviews': f.initial.aiReviews }[kind];
        await f.storage.transaction(tx => tx.put(kind, { corrupt: 'requires explicit reviewed recovery' }));
        const before = hashRows(f.driver);
        await expect(f.write([[kind, value]])).rejects.toThrow();
        expect(hashRows(f.driver)).toBe(before); await expect(f.read()).rejects.toThrow();
    });
    it('rejects accessors and toJSON without invoking them', async () => {
        const f = await fixture(); let invoked = 0;
        const getter = { ...f.initial.net }; Object.defineProperty(getter, 'lock', { enumerable: true, get() { invoked++; return 'off'; } });
        await expect(f.write([['net', getter]])).rejects.toThrow();
        await expect(f.write([['net', { ...f.initial.net, toJSON() { invoked++; return f.initial.net; } }]])).rejects.toThrow();
        expect(invoked).toBe(0);
    });
    it('rejects PM bodies in otherwise valid session pending and receipt metadata', async () => {
        const f = await fixture(), engine = createLobby({ now: () => NOW });
        for (const name of ['Alice', 'Bravo']) {
            const who = { id: `socket_${name}`, dev: `device_${name}`, iph: `ip_${name}`, role: 'fan', admin: false, account: '' };
            await engine.connect(who); await engine.message(who.id, JSON.stringify({ t: 'hello', nick: `Guest${name}`, age13: true }));
        }
        const sessions = engine.sessionSnapshot(), [alice, bravo] = sessions.connections;
        const pending = { key: [alice.id, bravo.id].sort().join('|'), from: alice.dev, fromId: alice.id, toId: bravo.id, at: NOW, hadFirst: true };
        await f.write([['sessions', { ...sessions, pendingPm: [pending] }]]);
        await expect(f.write([['sessions', { ...sessions, pendingPm: [{ ...pending, first: 'Private first message never retained' }] }]])).rejects.toThrow();
        const receipt = { t: 'pm', id: 'p123', ch: `pm:${alice.nick}>${bravo.nick}`, from: alice.nick, to: bravo.nick, prefix: '', band: false,
            moderator: false, me: false, ts: NOW, authorDev: alice.dev, digest: 'a'.repeat(64), recipients: [alice.id] };
        await f.write([['sessions', { ...sessions, receipts: [receipt] }]]);
        await expect(f.write([['sessions', { ...sessions, receipts: [{ ...receipt, text: 'Ordinary private body never retained' }] }]])).rejects.toThrow();
        const stored = [...f.driver.rows().values()].filter(value => value instanceof Uint8Array).map(value => Buffer.from(value).toString('utf8')).join('');
        expect(stored).not.toContain('Private first message never retained'); expect(stored).not.toContain('Ordinary private body never retained');
    });
    it('refuses missing/corrupt room-index and indexed missing/extra room rows without rebuilding an empty community', async () => {
        for (const damage of ['missing-index', 'bad-index', 'missing-room', 'extra-room']) {
            const f = await fixture();
            await f.storage.transaction(async tx => {
                if (damage === 'missing-index') await tx.delete('room-index');
                if (damage === 'bad-index') await tx.put('room-index', { version: 1, names: ['#duplicate', '#duplicate'] });
                if (damage === 'missing-room') await tx.put('room-index', { version: 1, names: ['#missing'] });
                if (damage === 'extra-room') await tx.put('community-room:#orphan', {});
            });
            const before = hashRows(f.driver); await expect(f.read()).rejects.toThrow(); expect(hashRows(f.driver)).toBe(before);
        }
    });
    it('fails closed at the unchanged physical budget for an oversized bulk room import', async () => {
        const f = await fixture(), engine = createLobby({ now: () => NOW });
        const who = { id: 'socket_Import', dev: 'device_Import', iph: 'ip_Import', account: '', role: 'fan', admin: false };
        await engine.connect(who); await engine.message(who.id, JSON.stringify({ t: 'hello', nick: 'ImportTester', age13: true }));
        await engine.message(who.id, JSON.stringify({ t: 'cmd', ch: '#stalemate', name: 'join', args: ['#template'] }));
        const template = engine.roomSnapshot().rooms[0], rooms = Array.from({ length: 1030 }, (_, n) => ({ ...template, name: `#bulk-${String(n).padStart(4, '0')}` }));
        const before = hashRows(f.driver); f.driver.resetOperations();
        await expect(f.write([['rooms', { version: 1, rooms }]])).rejects.toThrow('record-capacity');
        expect(f.driver.stats.operations.length).toBeLessThanOrEqual(4096); expect(hashRows(f.driver)).toBe(before);
        expect((await f.read()).rooms.rooms).toEqual([]);
    });
    it('keeps 2,000 exact logical log entries across disk reopen within the unchanged physical-operation ceiling', async () => {
        const entries = Array.from({ length: 2000 }, (_, n) => log(n)), f = await fixture({ logs: entries });
        const recovered = await f.reopen(); recovered.driver.resetOperations();
        const saved = await recovered.storage.transaction(tx => readLobbyState({ tx, now: NOW }));
        expect(saved.modlog).toEqual(entries);
        const calls = recovered.driver.stats.operations.length;
        expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThan(4096);
        expect(recovered.driver.stats.operations.filter(row => row.name === 'list').every(row => row.value.limit <= 4)).toBe(true);
        const index = await recovered.storage.transaction(tx => tx.get(LOBBY_LOG_INDEX));
        expect(index.segments).toHaveLength(32); expect(index.next).toBe(2000);
    });
    it('prunes expired entries anywhere, deletes obsolete segments and truncates partial segments atomically', async () => {
        const entries = Array.from({ length: 140 }, (_, n) => log(n, n % 3 === 0 ? NOW - LOG_TTL + 1000 : NOW - 1));
        const f = await fixture({ logs: entries }), before = await f.storage.transaction(tx => tx.get(LOBBY_LOG_INDEX));
        f.advance(1001); await f.write([['modlog', log(140, NOW + 1001)]]);
        const current = await f.read(), index = await f.storage.transaction(tx => tx.get(LOBBY_LOG_INDEX));
        expect(current.modlog).toEqual([...entries.filter(row => NOW + 1001 - row.at < LOG_TTL), log(140, NOW + 1001)]);
        expect(index.next).toBe(141); expect(index.segments).toHaveLength(2);
        for (const previous of before.segments) if (!index.segments.some(row => row.key === previous.key)) expect(await f.storage.transaction(tx => tx.get(previous.key))).toBeUndefined();
        const physical = [...f.driver.rows().keys()];
        for (const previous of before.segments) if (!index.segments.some(row => row.key === previous.key)) {
            expect(physical.some(key => key.includes(Buffer.from(previous.key).toString('hex')))).toBe(false);
        }
    });
    it('retains only the newest 2,000 entries and never reuses an allocated sequence after deletion', async () => {
        const f = await fixture({ logs: Array.from({ length: 2000 }, (_, n) => log(n)) });
        await f.write([['modlog', log(2000)], ['modlog', log(2001)]]);
        const saved = await f.read(); expect(saved.modlog).toHaveLength(2000); expect(saved.modlog[0].target).toBe('#test-2');
        expect(saved.modlog.at(-1).target).toBe('#test-2001');
        expect((await f.storage.transaction(tx => tx.get(LOBBY_LOG_INDEX))).next).toBe(2002);
    });
    it.each(['missing-index', 'bad-count', 'missing-segment', 'extra-segment', 'body-field', 'duplicate-sequence'])('refuses %s log corruption and preserves every physical record', async damage => {
        const f = await fixture({ logs: [log(1), log(2)] });
        await f.storage.transaction(async tx => {
            const index = await tx.get(LOBBY_LOG_INDEX), key = index.segments[0].key, segment = await tx.get(key);
            if (damage === 'missing-index') await tx.delete(LOBBY_LOG_INDEX);
            if (damage === 'bad-count') { index.segments[0].count++; await tx.put(LOBBY_LOG_INDEX, index); }
            if (damage === 'missing-segment') await tx.delete(key);
            if (damage === 'extra-segment') await tx.put(`${LOBBY_LOG_PREFIX}9999999999999999`, segment);
            if (damage === 'body-field') { segment.entries[0].entry.text = 'not an allowed moderation log field'; await tx.put(key, segment); }
            if (damage === 'duplicate-sequence') { segment.entries[1].seq = segment.entries[0].seq; await tx.put(key, segment); }
        });
        const before = hashRows(f.driver); await expect(f.read()).rejects.toThrow(); await expect(f.write([['modlog', log(3)]])).rejects.toThrow(); expect(hashRows(f.driver)).toBe(before);
    });
    it('refuses incompatible legacy log rows introduced after initialization instead of silently ignoring them', async () => {
        const f = await fixture({ logs: [log(1)] });
        await f.storage.transaction(tx => tx.put('log:180000000000000:legacy-writer', log(2)));
        const before = hashRows(f.driver);
        await expect(f.read()).rejects.toThrow();
        await expect(f.write([['modlog', log(3)]])).rejects.toThrow();
        await expect(f.storage.transaction(tx => pruneLobbyEffectLogs({ tx, now: NOW }))).rejects.toThrow();
        expect(hashRows(f.driver)).toBe(before);
    });
    it('rolls back segment replacement, obsolete deletion and log-index change after the last actual index write fails', async () => {
        const f = await fixture({ logs: Array.from({ length: 70 }, (_, n) => log(n, n < 65 ? NOW - LOG_TTL + 1000 : NOW)) }), before = hashRows(f.driver);
        f.advance(1001);
        let injected = false;
        f.hooks.after = event => {
            if (!injected && event.name === 'put' && event.key.endsWith(Buffer.from(LOBBY_LOG_INDEX).toString('hex'))) { injected = true; throw Error('after actual index manifest write'); }
        };
        await expect(f.write([['modlog', log(71, NOW + 1001)]])).rejects.toThrow(); f.hooks.after = undefined;
        expect(injected).toBe(true); expect(hashRows(f.driver)).toBe(before);
        expect((await f.read()).modlog).toHaveLength(5);
        const index = await f.storage.transaction(tx => tx.get(LOBBY_LOG_INDEX)); expect(index.next).toBe(70); expect(index.segments.map(row => row.count)).toEqual([64, 6]);
    });
});


describe('optional room-instance metadata in indexed state', () => {
    it('round-trips a live room reference and rejects corrupt writes without replacing prior indexed state', async () => {
        const f = await fixture(), engine = createLobby({ now: () => NOW, limits: { defaultSlow: 0 } });
        engine.connect({ id: 'founder', dev: 'founder-device', iph: 'founder-network', account: 'founder-account' });
        engine.message('founder', JSON.stringify({ t: 'hello', nick: 'Founder', age13: true }));
        engine.message('founder', JSON.stringify({ t: 'cmd', name: 'join', args: ['#keep-reference'], ch: '#stalemate' }));
        const rooms = engine.roomSnapshot(), ref = rooms.rooms[0].keepRef;
        expect(ref).toMatch(/^[a-f0-9]{32}$/);
        await f.write([['rooms', rooms]]);
        expect((await f.read()).rooms.rooms[0].keepRef).toBe(ref);
        const before = hashRows(f.driver), corrupt = structuredClone(rooms); corrupt.rooms[0].keepRef = 'not-a-room-instance';
        await expect(f.write([['net', { ...f.initial.net, lock: 'readonly' }], ['rooms', corrupt]])).rejects.toThrow();
        expect(hashRows(f.driver)).toBe(before);
        const restored = createLobby({ now: () => NOW }); restored.restoreRooms((await f.read()).rooms);
        expect(restored._debug.channels.get('#keep-reference').keepRef).toBe(ref);
    });
    it('accepts legacy rows without a reference, then gives restoration a fresh nonmatching instance', async () => {
        const f = await fixture(), engine = createLobby({ now: () => NOW });
        engine.connect({ id: 'founder', dev: 'founder-device', iph: 'founder-network' });
        engine.message('founder', JSON.stringify({ t: 'hello', nick: 'Founder', age13: true }));
        engine.message('founder', JSON.stringify({ t: 'cmd', name: 'join', args: ['#legacy-reference'], ch: '#stalemate' }));
        const legacy = engine.roomSnapshot(), prior = legacy.rooms[0].keepRef; delete legacy.rooms[0].keepRef;
        await f.write([['rooms', legacy]]);
        expect((await f.read()).rooms).toEqual(legacy);
        const restored = createLobby({ now: () => NOW }); restored.restoreRooms((await f.read()).rooms);
        expect(restored._debug.channels.get('#legacy-reference').keepRef).toMatch(/^[a-f0-9]{32}$/);
        expect(restored._debug.channels.get('#legacy-reference').keepRef).not.toBe(prior);
    });
});

describe('strict restricted-safety session records', () => {
    it('accepts multiple empty-nick safety witnesses but refuses public state or false/unknown flags atomically', async () => {
        const f = await fixture(), engine = createLobby({ now: () => NOW });
        for (const [id, nick] of [['one', 'OneGuest'], ['two', 'TwoGuest']]) {
            expect(engine.connect({ id, dev: `dev_${id}`, iph: `ip_${id}` }).ok).toBe(true);
            await engine.message(id, JSON.stringify({ t: 'hello', nick, age13: true }));
        }
        const saved = engine.sessionSnapshot();
        for (const row of saved.connections) Object.assign(row, { safetyOnly: true, nick: '', entrySource: '', channels: [], away: '', cams: [], pmOff: true, lastSaid: {} });
        await f.write([['sessions', saved]]); expect((await f.read()).sessions).toEqual(saved);
        for (const kind of ['pm', 'pendingPm']) {
            const broken = structuredClone(saved), [from, to] = broken.connections;
            broken[kind] = [{ key: [from.id, to.id].sort().join('|'), from: from.dev, fromId: from.id, toId: to.id, ...(kind === 'pm' ? { state: 'open' } : { at: NOW, hadFirst: false }) }];
            const before = hashRows(f.driver); await expect(f.write([['sessions', broken]])).rejects.toThrow(); expect(hashRows(f.driver)).toBe(before);
        }
        for (const change of [{ safetyOnly: false }, { nick: 'PublicAgain' }, { channels: ['#stalemate'] }, { cams: ['#art-room'] }, { pmOff: false }, { unknownAuthority: true }]) {
            const broken = structuredClone(saved); Object.assign(broken.connections[0], change); const before = hashRows(f.driver);
            await expect(f.write([['sessions', broken]])).rejects.toThrow(); expect(hashRows(f.driver)).toBe(before);
        }
    });
});


describe('bounded PM peer-reference session metadata through actual SQLite', () => {
    async function sessionFixture() {
        const f = await fixture(); let at = NOW; const sent = [];
        const engine = createLobby({ now: () => at, limits: { defaultSlow: 0 }, send: (recipient, frame) => sent.push({ recipient, ...structuredClone(frame) }) });
        for (const nick of ['Alice', 'Bravo', 'Charlie']) {
            const id = `socket_${nick}`;
            engine.connect({ id, dev: `device_${nick}`, iph: `ip_${nick}`, role: 'fan', admin: false, account: '' });
            engine.message(id, JSON.stringify({ t: 'hello', nick, age13: true }));
        }
        at += 180000; f.advance(180000);
        const command = (nick, name, args) => engine.message(`socket_${nick}`, JSON.stringify({ t: 'cmd', name, args, ch: '#stalemate' }));
        command('Alice', 'query', ['Bravo']); command('Bravo', 'accept', ['Alice']);
        command('Alice', 'query', ['Charlie']);
        return { f, engine, command, sent };
    }

    it('commits and reopens real generated pending/open references without persisting an ordinary private body', async () => {
        const { f, engine, sent } = await sessionFixture();
        const ref = engine.sessionSnapshot().pm[0].ref, body = 'This genuinely delivered private body stays out of retained session metadata';
        engine.message('socket_Alice', JSON.stringify({ t: 'say', ch: `pm:${ref}`, pmPeer: 'socket_Bravo', pmRef: ref, text: body }));
        expect(sent.filter(frame => frame.t === 'pm' && frame.text === body)).toHaveLength(2);
        const sessions = engine.sessionSnapshot();
        expect(sessions.receipts).toHaveLength(1);
        expect(sessions.pm).toHaveLength(1); expect(sessions.pendingPm).toHaveLength(1);
        expect(sessions.pm[0].ref).toMatch(/^[a-f0-9]{32}$/); expect(sessions.pendingPm[0].ref).toMatch(/^[a-f0-9]{32}$/);
        expect(sessions.pm[0].ref).not.toBe(sessions.pendingPm[0].ref);
        await f.write([['sessions', sessions]]);
        const reopened = await f.reopen();
        const saved = await reopened.storage.transaction(tx => readLobbyState({ tx, now: NOW + 180000 }));
        expect(saved.sessions).toEqual(sessions);
        expect(JSON.stringify(saved.sessions)).not.toContain(body);
        expect(JSON.stringify(saved.sessions)).not.toContain('text');
    });

    it.each(['malformed', 'duplicate', 'body'])('rolls back physical records for %s peer metadata without sanitizing or truncating it', async damage => {
        const { f, engine } = await sessionFixture(), sessions = engine.sessionSnapshot();
        await f.write([['sessions', sessions]]); const before = hashRows(f.driver);
        const changed = structuredClone(sessions);
        if (damage === 'malformed') changed.pendingPm[0].ref = 'not-a-reference';
        if (damage === 'duplicate') changed.pendingPm[0].ref = changed.pm[0].ref;
        if (damage === 'body') changed.pendingPm[0].first = 'An ordinary private body must never enter metadata';
        await expect(f.write([['sessions', changed]])).rejects.toThrow();
        expect(hashRows(f.driver)).toBe(before);
        expect((await f.read()).sessions).toEqual(sessions);
    });
});
