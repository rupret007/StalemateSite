// @vitest-environment node
// Real engine admission/actions and its existing controlled-output ceiling.
// Synthetic trusted identities are explicit; this is not hosted capacity or
// actual Access/profile issuance qualification. No engine limit is increased.
import { beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { createLobby, LOBBY_LIMITS } from '../../hangout-worker/src/lobby-core.mjs';
import { createEntrySiteRegistry } from '../../r/45662413410ed051/entry-sites.mjs';
import { accountId } from '../../hangout-worker/src/auth.mjs';

const SOURCE = 'capacity-community-entry-fixture'.padEnd(32, 'x');
const ROOMS = Array.from({ length: LOBBY_LIMITS.roomsListed }, (_, n) => `#art-capacity-${String(n).padStart(2, '0')}`);
let f;
beforeAll(async () => {
    let at = 1800000000000;
    const ownerAccount = await accountId('owner@example.invalid', 'synthetic-capacity-account-key-not-a-secret');
    const make = (prefix, n, staff) => ({ id: randomUUID(), dev: randomBytes(16).toString('base64url'),
        iph: `capacity-ip-${prefix}-${n}`, nick: `${prefix}${String(n).padStart(3, '0')}abcdefghijkl`,
        role: staff ? 'owner' : 'fan', account: staff ? ownerAccount : '', admin: staff });
    const guests = Array.from({ length: LOBBY_LIMITS.roomMax }, (_, n) => make('Guest', n, false));
    // Fifty synthetic trusted staff connections exercise the existing staff
    // room-admission exception; 50 is a fixture size, not a claimed profile cap.
    // Eight ordinary visitors are admitted before staff. No limit is raised.
    const staff = Array.from({ length: 50 }, (_, n) => make('Staff', n, true));
    const views = new Map(), published = [], commits = { prepared: 0, semantic: 0, costs: 0 };
    const setup = { actions: 0, refusals: [], maxElapsedMs: 0 };
    f = { guests, staff, views, published, commits, setup, monitoring: false };
    const engine = createLobby({ now: () => at,
        limits: { entrySites: createEntrySiteRegistry([{ id: SOURCE, label: 'Capacity fixture only' }]) },
        send: (id, frame) => {
            if (id === guests[0].id && frame.t === 'chan' && frame.ch.kind !== 'lobby') views.set(frame.ch.name, frame.ch);
            if (f.monitoring) published.push({ recipient: id, ...structuredClone(frame) });
        },
        effectCommit: { prepare: operation => { commits.prepared += 1; return operation; }, commit: async (_context, _effects, { costsOnly }) => {
            commits[costsOnly ? 'costs' : 'semantic'] += 1; return { ok: true };
        } } });
    const setupAction = async (who, frame, invoke) => {
        const room = frame.t === 'cmd' && frame.name === 'join' ? frame.args[0] : frame.ch;
        const state = () => ({ ...commits, roomIndex: ROOMS.indexOf(room),
            memberCount: engine._debug.channels.get(room)?.members.size ?? 0,
            memberPresent: engine._debug.channels.get(room)?.members.has(who.id) ?? false });
        const before = state(), started = performance.now();
        const result = await invoke();
        const elapsedMs = performance.now() - started, after = state();
        setup.actions += 1; setup.maxElapsedMs = Math.max(setup.maxElapsedMs, elapsedMs);
        const diagnostic = { scope: 'capacity-fixture-setup-only', action: `${frame.t}/${frame.name || ''}`,
            nick: who.nick, room: room ?? null, reason: typeof result?.reason === 'string' ? result.reason.slice(0, 128) : null,
            elapsedMs: Math.round(elapsedMs * 1000) / 1000, before, after };
        if (result?.ok === false) {
            // Retain bounded evidence and fail. Never retry the Block under test,
            // suppress an admission failure or change the real monotonic clock.
            if (setup.refusals.length < 8) setup.refusals.push(diagnostic);
            console.warn(JSON.stringify(diagnostic));
        }
        expect(result?.ok, JSON.stringify(diagnostic)).not.toBe(false);
        return result;
    };
    const message = (who, frame) => setupAction(who, frame, () => engine.message(who.id, JSON.stringify(frame)));
    const cmd = (who, name, args, ch = '#stalemate') => message(who, { t: 'cmd', ch, name, args });
    Object.assign(f, { engine, message, cmd, advance: ms => { at += ms; } });
    for (const person of [...guests, ...staff]) {
        expect(await setupAction(person, { t: 'connect' }, () => engine.connect(person))).toMatchObject({ ok: true });
        await message(person, { t: 'hello', nick: person.nick, age13: true, entrySource: SOURCE });
        expect(engine._debug.conns.get(person.id).nick).toBe(person.nick);
    }
});

// Keep setup phases within existing individual hook limits. These phases do
// not establish a whole-fixture latency or production throughput guarantee.
for (const [index, room] of ROOMS.entries()) beforeAll(async () => {
    // Eight founders rotate; creation is 24 minutes apart per device, within the
    // existing 10-minute/device and 3/hour/IP rules, with no synthetic mutation.
    f.advance(3 * 60000);
    const founder = f.guests[index % f.guests.length];
    await f.cmd(founder, 'join', [room]);
    for (const guest of f.guests) if (guest !== founder) await f.cmd(guest, 'join', [room]);
    expect(f.engine._debug.channels.get(room).members.size).toBe(LOBBY_LIMITS.roomMax);
    for (const person of f.staff) await f.cmd(person, 'join', [room]);
    expect(f.engine._debug.channels.get(room).members.size).toBe(LOBBY_LIMITS.roomMax + f.staff.length);
});

describe('Block remains available at accepted shared-room membership', () => {
    it('commits one device block across 30 accepted rooms without exceeding the existing staged-output budget', async () => {
        const blocker = f.guests[0], target = f.staff[0];
        console.log(JSON.stringify({ scope: 'capacity-fixture-setup-summary', actions: f.setup.actions,
            refusals: f.setup.refusals, maxElapsedMs: Math.round(f.setup.maxElapsedMs * 1000) / 1000 }));
        expect(f.views.size).toBe(LOBBY_LIMITS.roomsListed);
        const baselineRefreshBytes = [...f.views.values()].reduce((total, view) =>
            total + Buffer.byteLength(JSON.stringify({ t: 'chan', ch: view })) * view.count, 0);
        const semanticBefore = f.commits.semantic;
        f.monitoring = true;
        const result = await f.engine.message(blocker.id, JSON.stringify({ t: 'cmd', ch: '#stalemate', name: 'block', args: [target.nick] }));
        const policyFrames = f.published.filter(frame => frame.t === 'media-policy');
        const publishedBytes = f.published.reduce((total, { recipient: _recipient, ...frame }) =>
            total + Buffer.byteLength(JSON.stringify(frame)), 0);
        console.log(JSON.stringify({ rooms: ROOMS.length, ordinaryVisitors: f.guests.length, staff: f.staff.length,
            membersPerRoom: f.views.get(ROOMS[0]).count, baselineFullRefreshBytes: baselineRefreshBytes,
            unchangedStageByteCeiling: 16 * 1024 * 1024, result: result ?? null,
            blockRecorded: f.engine._debug.conns.get(blocker.id).blocks.has(target.dev),
            semanticCommits: f.commits.semantic - semanticBefore, publishedFrames: f.published.length, publishedBytes,
            policyFrames: policyFrames.length }));
        expect(baselineRefreshBytes).toBeGreaterThan(16 * 1024 * 1024);
        expect(result?.ok).not.toBe(false);
        expect(f.engine._debug.conns.get(blocker.id).blocks.has(target.dev)).toBe(true);
        expect(f.commits.semantic).toBe(semanticBefore + 1);
        expect(f.published.some(frame => frame.text?.startsWith('Blocked '))).toBe(true);
        expect(f.published).toHaveLength(2 * ROOMS.length + 3);
        expect(f.published.length).toBeLessThanOrEqual(8192);
        expect(publishedBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
        expect(policyFrames).toHaveLength(2 * ROOMS.length);
        for (const frame of policyFrames) {
            expect(ROOMS).toContain(frame.ch);
            expect([blocker.id, target.id]).toContain(frame.recipient);
            expect(frame.changes).toEqual([{ id: frame.recipient === blocker.id ? target.id : blocker.id, blocked: true }]);
            expect(frame).not.toHaveProperty('names');
            expect(JSON.stringify(frame)).not.toContain(target.dev);
        }
    });
});
