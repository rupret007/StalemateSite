// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';
import { OWNER_TRANSFER_TTL } from '../../hangout-worker/src/community-state.mjs';

const channel = '#ownership-recovery';
let engine, clock, sequence, frames, writes, identities, persistHook;
async function boot(rooms, sessions, live = []) {
    frames = []; writes = [];
    engine = createLobby({ now: () => clock, send: (id, frame) => frames.push({ id, ...frame }),
        persist: (kind, value) => {
            writes.push({ kind, value: structuredClone(value) });
            return persistHook?.(kind, value);
        }, limits: { defaultSlow: 0 } });
    if (rooms) await engine.restoreRooms(rooms);
    if (sessions) return engine.restoreSessions(sessions, live);
}
function message(id, frame) { clock += 2000; return engine.message(id, JSON.stringify(frame)); }
const cmd = (id, name, args = [], intent = {}) => message(id, { t: 'cmd', name, args, ch: channel, ...intent });
const room = () => engine._debug.channels.get(channel);
async function visitor(nick, account, dev = `device-${nick}`) {
    const identity = { id: `connection-${++sequence}`, dev, iph: `ip-${nick}`, account, role: 'fan', admin: false };
    expect(engine.connect(identity).ok).toBe(true);
    identities.set(identity.id, identity);
    await message(identity.id, { t: 'hello', nick, age13: true });
    return identity.id;
}
async function offer() {
    const owner = await visitor('Owner', 'account-owner');
    await cmd(owner, 'join', [channel]); await cmd(owner, 'register');
    const cohost = await visitor('Cohost', 'account-cohost');
    await cmd(cohost, 'join', [channel]); await cmd(owner, 'cohost', ['add', 'Cohost'], { personNamed: true });
    await cmd(owner, 'transfer', ['Cohost'], { personNamed: true });
    return { owner, cohost };
}
function snapshot() {
    return { rooms: engine.roomSnapshot(), sessions: engine.sessionSnapshot(), live: [...identities.values()] };
}
const errors = (id) => frames.filter((f) => f.id === id && f.kind === 'error').map((f) => f.text).join('\n');
beforeEach(async () => { clock = 1800000000000; sequence = 0; identities = new Map(); persistHook = undefined; await boot(); });

describe('durable ownership offers', () => {
    it('resumes an unexpired account-bound offer on the exact live sockets without extending its deadline', async () => {
        const { owner, cohost } = await offer();
        const original = { ...room().transfer };
        expect(original).toEqual({ from: 'account-owner', to: 'account-cohost', until: clock + OWNER_TRANSFER_TTL });
        const saved = snapshot();
        expect(saved.rooms.rooms[0].transfer).toEqual(original);
        clock += 9 * 60000;

        const restored = await boot(saved.rooms, saved.sessions, saved.live);

        expect(restored).toEqual({ resumed: [owner, cohost], rejected: [] });
        expect(room().transfer).toEqual(original);
        await cmd(cohost, 'acceptowner');
        expect(room().owner).toBe('account-cohost');
        expect(room().cohosts.has('account-owner')).toBe(true);
        expect(room().transfer).toBeNull();
        expect(engine.roomSnapshot().rooms[0]).not.toHaveProperty('transfer');

        const accepted = snapshot();
        await boot(accepted.rooms, accepted.sessions, accepted.live);
        await cmd(owner, 'acceptowner'); await cmd(cohost, 'acceptowner');
        expect(room().owner).toBe('account-cohost');
        expect(errors(owner)).toContain('No valid ownership offer');
        expect(errors(cohost)).toContain('No valid ownership offer');
    });

    it('clears an offer at its original deadline on wake and durably removes it', async () => {
        const { cohost } = await offer();
        const saved = snapshot();
        clock = room().transfer.until;

        await boot(saved.rooms, saved.sessions, saved.live);

        expect(room().transfer).toBeNull();
        expect(writes.filter((w) => w.kind === 'rooms').at(-1).value.rooms[0]).not.toHaveProperty('transfer');
        await cmd(cohost, 'acceptowner');
        expect(room().owner).toBe('account-owner');
        expect(errors(cohost)).toContain('No valid ownership offer');
    });

    it('expires an outstanding offer during an ordinary alarm tick', async () => {
        await offer(); clock = room().transfer.until;
        await engine.tick();
        expect(room().transfer).toBeNull();
        expect(writes.filter((w) => w.kind === 'rooms').at(-1).value.rooms[0]).not.toHaveProperty('transfer');
    });

    it('does not rebind an offer to a reused nickname or anonymous original device after restart', async () => {
        const { cohost } = await offer();
        await engine.disconnect(cohost); identities.delete(cohost);
        const saved = snapshot();
        await boot(saved.rooms, saved.sessions, saved.live);
        const reused = await visitor('Cohost', 'account-stranger', 'different-device');
        await cmd(reused, 'join', [channel]); await cmd(reused, 'acceptowner');
        expect(room().owner).toBe('account-owner');
        expect(errors(reused)).toContain('No valid ownership offer');
        const anonymous = await visitor('Anonymous', '', 'device-Cohost');
        await cmd(anonymous, 'join', [channel]); await cmd(anonymous, 'acceptowner');
        expect(room().owner).toBe('account-owner');
        expect(errors(anonymous)).toContain('No valid ownership offer');

        const verified = await visitor('Returned', 'account-cohost', 'new-verified-device');
        await cmd(verified, 'join', [channel]); await cmd(verified, 'acceptowner');
        expect(room().owner).toBe('account-cohost');
    });

    it('persists cancellation when the offered co-host grant is revoked', async () => {
        const { owner, cohost } = await offer();
        await cmd(owner, 'cohost', ['remove', 'Cohost'], { personNamed: true });
        const saved = snapshot();
        expect(saved.rooms.rooms[0]).not.toHaveProperty('transfer');
        await boot(saved.rooms, saved.sessions, saved.live);
        await cmd(cohost, 'acceptowner');
        expect(room().owner).toBe('account-owner');
        expect(errors(cohost)).toContain('No valid ownership offer');
    });

    it('withholds the ownership offer until the room metadata commit succeeds', async () => {
        const { owner } = await offer();
        let commit;
        persistHook = (kind) => kind === 'rooms' ? new Promise((resolve) => { commit = resolve; }) : undefined;
        clock += 10000; frames = [];
        const pending = cmd(owner, 'transfer', ['Cohost'], { personNamed: true });
        expect(commit).toBeTypeOf('function');
        expect(frames.some((f) => f.t === 'owner-offer')).toBe(false);
        commit(); await pending;
        expect(frames.filter((f) => f.t === 'owner-offer')).toHaveLength(1);
    });

    it('does not advertise an ownership offer when its required commit fails', async () => {
        const { owner } = await offer();
        persistHook = (kind) => kind === 'rooms' ? Promise.reject(new Error('storage unavailable')) : undefined;
        clock += 10000; frames = [];
        await cmd(owner, 'transfer', ['Cohost'], { personNamed: true });
        expect(frames.some((f) => f.t === 'owner-offer')).toBe(false);
        expect(engine.adminState().lock).toBe('readonly');
    });

    it.each([
        { from: 'different-owner', to: 'account-cohost', until: 1800000600000 },
        { from: 'account-owner', to: 'not-a-cohost', until: 1800000600000 },
        { from: 'account-owner', to: 'account-owner', until: 1800000600000 },
        { from: 'account-owner', to: 'account-cohost', until: Infinity },
        { from: 'account-owner', to: 'account-cohost', until: 1800000600000, extra: 'unbounded' },
        { from: 'account-owner', to: 'account-cohost', until: 1800000600000, fromNick: 'Owner' }
    ])('fails closed on malformed or mismatched durable transfer metadata %#', async (transfer) => {
        await offer();
        const saved = snapshot(); saved.rooms.rooms[0].transfer = transfer;
        await boot(saved.rooms);
        expect(room()).toBeUndefined();
        expect(engine.adminState().lock).toBe('readonly');
    });

    it('cannot restore an old-owner offer after the stored room owner changes', async () => {
        await offer();
        const saved = snapshot(); saved.rooms.rooms[0].owner = 'account-new-owner';
        await boot(saved.rooms);
        expect(room()).toBeUndefined();
        expect(engine.adminState().lock).toBe('readonly');
    });

    it('rejects a stored deadline beyond the original ten-minute bound', async () => {
        await offer();
        const saved = snapshot(); saved.rooms.rooms[0].transfer.until = clock + OWNER_TRANSFER_TTL + 1;
        await boot(saved.rooms);
        expect(room()).toBeUndefined();
        expect(engine.adminState().lock).toBe('readonly');
    });
});
