// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';

const channel = '#cohost-proof';
let engine, clock, frames, writes, identities, sequence;
function boot() {
    frames = []; writes = [];
    engine = createLobby({ now: () => clock, send: (id, frame) => frames.push({ id, ...frame }),
        persist: (kind, value) => writes.push({ kind, value: structuredClone(value) }), limits: { defaultSlow: 0 } });
}
function message(id, frame) { clock += 2000; return engine.message(id, JSON.stringify(frame)); }
const cmd = (id, name, args = [], ch = channel, intent = {}) => message(id, { t: 'cmd', name, args, ch, ...intent });
function visitor(nick, account = '', dev = `device-${nick}`) {
    const identity = { id: `connection-${++sequence}`, dev, iph: `ip-${nick}`, account, role: 'fan', admin: false };
    expect(engine.connect(identity).ok).toBe(true);
    identities.set(identity.id, identity);
    message(identity.id, { t: 'hello', nick, age13: true });
    return identity.id;
}
function disconnect(id) { engine.disconnect(id); identities.delete(id); }
const room = () => engine._debug.channels.get(channel);
function registeredRoom() {
    const owner = visitor('Owner', 'account-owner');
    cmd(owner, 'join', [channel]); cmd(owner, 'register');
    expect(room().owner).toBe('account-owner');
    return owner;
}
function overlappingCohost(owner, nick = 'Bravo', dev = `device-${nick}`) {
    const id = visitor(nick, 'account-bravo', dev);
    cmd(id, 'join', [channel]); cmd(owner, 'op', [nick], channel, { personNamed: true }); cmd(owner, 'cohost', ['add', nick], channel, { personNamed: true });
    return id;
}
function cannotSetTopic(id) {
    const previous = room().topic;
    cmd(id, 'topic', ['Revoked visitor attempted topic']);
    expect(room().topic).toBe(previous);
    expect(frames.filter(f => f.id === id && f.t === 'denied').at(-1)?.cmd).toBe('topic');
}
beforeEach(() => { clock = 1800000000000; identities = new Map(); sequence = 0; boot(); });

describe('verified co-host revocation', () => {
    it.each(['account-bravo', 'Bravo'])('removal by %s revokes all proved devices and preserves other grants', removeBy => {
        const owner = registeredRoom();
        const first = overlappingCohost(owner);
        const second = visitor('BravoOther', 'account-bravo', 'device-bravo-other');
        cmd(second, 'join', [channel]); cmd(owner, 'op', ['BravoOther'], channel, { personNamed: true });
        const other = visitor('Charlie', 'account-charlie');
        cmd(other, 'join', [channel]); cmd(owner, 'op', ['Charlie'], channel, { personNamed: true }); cmd(owner, 'cohost', ['add', 'Charlie'], channel, { personNamed: true });
        const guest = visitor('Guest'); cmd(guest, 'join', [channel]); cmd(owner, 'op', ['Guest'], channel, { personNamed: true });
        cmd(owner, 'transfer', ['Bravo'], channel, { personNamed: true });

        cmd(owner, 'cohost', ['remove', removeBy], channel, removeBy === 'account-bravo'
            ? { cohostAccount: true, roomInstance: room().keepRef } : { personNamed: true });

        expect(room().cohosts.has('account-bravo')).toBe(false);
        expect(room().cohostLabels['account-bravo']).toBeUndefined();
        expect(room().transfer).toBeNull();
        expect(room().ops.has('device-Bravo')).toBe(false);
        expect(room().ops.has('device-bravo-other')).toBe(false);
        cannotSetTopic(first); cannotSetTopic(second);
        cmd(first, 'acceptowner'); expect(room().owner).toBe('account-owner');
        expect(room().cohosts.has('account-charlie')).toBe(true);
        expect(room().ops.has('device-Charlie')).toBe(true);
        expect(room().ops.has('device-Guest')).toBe(true);
        cmd(other, 'topic', ['Other verified host keeps controls']);
        expect(room().topic).toBe('Other verified host keeps controls');
        cmd(guest, 'topic', ['Independent guest host keeps controls']);
        expect(room().topic).toBe('Independent guest host keeps controls');
        cmd(owner, 'topic', ['Owner keeps controls']); expect(room().topic).toBe('Owner keeps controls');
        const saved = writes.filter(w => w.kind === 'rooms').at(-1).value.rooms.find(r => r.name === channel);
        expect(saved.cohosts).toEqual(['account-charlie']);
        expect(saved.ops).toEqual(expect.arrayContaining(['device-Charlie', 'device-Guest']));
        expect(saved.ops).not.toContain('device-Bravo'); expect(saved.ops).not.toContain('device-bravo-other');
    });

    it('uses the verified binding after reconnect and does not act on a reused nickname', () => {
        const owner = registeredRoom();
        const original = overlappingCohost(owner, 'Bravo', 'original-device');
        disconnect(original);
        const unrelated = visitor('Bravo', 'account-unrelated', 'unrelated-device');
        cmd(unrelated, 'join', [channel]); cmd(owner, 'op', ['Bravo'], channel, { personNamed: true });
        const returned = visitor('Returned', 'account-bravo', 'original-device');
        cmd(returned, 'join', [channel]);

        cmd(owner, 'cohost', ['remove', 'account-bravo'], channel, { cohostAccount: true, roomInstance: room().keepRef });

        expect(room().ops.has('original-device')).toBe(false);
        expect(room().ops.has('unrelated-device')).toBe(true);
        cannotSetTopic(returned);
        cmd(unrelated, 'topic', ['Different account keeps its own guest grant']);
        expect(room().topic).toBe('Different account keeps its own guest grant');
    });

    it('revokes a proved device even when that live account has left the room', () => {
        const owner = registeredRoom();
        const cohost = overlappingCohost(owner);
        cmd(cohost, 'part');
        expect(room().members.has(cohost)).toBe(false);
        cmd(owner, 'cohost', ['remove', 'account-bravo'], channel, { cohostAccount: true, roomInstance: room().keepRef });
        expect(room().ops.has('device-Bravo')).toBe(false);
        cmd(cohost, 'join', [channel]); cannotSetTopic(cohost);
    });

    it('uses exact restored live identities to revoke multiple devices after hibernation', () => {
        const owner = registeredRoom();
        const first = overlappingCohost(owner);
        const second = visitor('BravoOther', 'account-bravo', 'device-bravo-other');
        cmd(second, 'join', [channel]); cmd(owner, 'op', ['BravoOther'], channel, { personNamed: true });
        const savedRooms = engine.roomSnapshot(), savedSessions = engine.sessionSnapshot(), live = [...identities.values()];
        boot(); engine.restoreRooms(savedRooms);
        const restored = engine.restoreSessions(savedSessions, live);
        expect(restored.rejected).toEqual([]);
        expect(restored.resumed).toHaveLength(3);

        cmd(owner, 'cohost', ['remove', 'account-bravo'], channel, { cohostAccount: true, roomInstance: room().keepRef });

        cannotSetTopic(first); cannotSetTopic(second);
        expect(room().ops.size).toBe(0);
        expect(room().owner).toBe('account-owner');
    });

    it('preserves an unrelated transfer offer and other verified grants', () => {
        const owner = registeredRoom(); overlappingCohost(owner);
        const other = visitor('Charlie', 'account-charlie');
        cmd(other, 'join', [channel]); cmd(owner, 'cohost', ['add', 'Charlie'], channel, { personNamed: true }); cmd(owner, 'transfer', ['Charlie'], channel, { personNamed: true });
        cmd(owner, 'cohost', ['remove', 'account-bravo'], channel, { cohostAccount: true, roomInstance: room().keepRef });
        expect(room().transfer?.to).toBe('account-charlie');
        cmd(other, 'acceptowner');
        expect(room().owner).toBe('account-charlie');
        expect(room().cohosts.has('account-owner')).toBe(true);
    });

    it('serializes proved grants and revokes offline devices after restart before either reconnects', () => {
        let owner = registeredRoom();
        const first = overlappingCohost(owner);
        const second = visitor('BravoOther', 'account-bravo', 'device-bravo-other');
        cmd(second, 'join', [channel]); cmd(owner, 'op', ['BravoOther'], channel, { personNamed: true });
        const guest = visitor('Guest'); cmd(guest, 'join', [channel]); cmd(owner, 'op', ['Guest'], channel, { personNamed: true });
        disconnect(first); disconnect(second); disconnect(guest); disconnect(owner);
        const saved = engine.roomSnapshot();
        expect(saved.rooms[0].opAccounts).toEqual(expect.arrayContaining([
            ['device-Bravo', 'account-bravo'], ['device-bravo-other', 'account-bravo']
        ]));
        expect(saved.rooms[0].opAccounts).toHaveLength(2);
        expect(saved.rooms[0].ops).toEqual(expect.arrayContaining(['device-Bravo', 'device-bravo-other', 'device-Guest']));
        boot(); engine.restoreRooms(saved);
        owner = visitor('OwnerBack', 'account-owner', 'new-owner-device'); cmd(owner, 'join', [channel]);

        cmd(owner, 'cohost', ['remove', 'account-bravo'], channel, { cohostAccount: true, roomInstance: room().keepRef });

        expect(room().opAccounts.size).toBe(0);
        expect(room().ops.has('device-Guest')).toBe(true);
        // Both verified and anonymous reconnects with the previously granted
        // devices must fail to recover the revoked device grants.
        const returned = visitor('BravoBack', 'account-bravo', 'device-Bravo');
        cmd(returned, 'join', [channel]); cannotSetTopic(returned);
        const anonymous = visitor('AnonymousBack', '', 'device-bravo-other');
        cmd(anonymous, 'join', [channel]); cannotSetTopic(anonymous);
        const unrelated = visitor('GuestBack', '', 'device-Guest'); cmd(unrelated, 'join', [channel]);
        cmd(unrelated, 'topic', ['Unrelated guest grant survives restart']);
        expect(room().topic).toBe('Unrelated guest grant survives restart');
    });

    it('cleans grant associations on deop and owner registration', () => {
        const owner = visitor('Owner', 'account-owner'); cmd(owner, 'join', [channel]);
        expect(room().opAccounts.get('device-Owner')).toBe('account-owner');
        cmd(owner, 'register');
        expect(room().opAccounts.size).toBe(0);
        const cohost = overlappingCohost(owner);
        expect(room().opAccounts.get('device-Bravo')).toBe('account-bravo');
        cmd(owner, 'deop', ['Bravo'], channel, { personNamed: true });
        expect(room().opAccounts.has('device-Bravo')).toBe(false);
        expect(engine.roomSnapshot().rooms[0].opAccounts).toEqual([]);
        // Removing the independent device grant does not remove the verified
        // co-host grant; explicitly revoking that is a separate owner action.
        expect(room().cohosts.has('account-bravo')).toBe(true);
        cmd(cohost, 'topic', ['Verified cohost still has its account grant']);
        expect(room().topic).toBe('Verified cohost still has its account grant');
    });

    it('preserves a device grant explicitly reassigned to a different verified account', () => {
        const owner = registeredRoom();
        const original = overlappingCohost(owner, 'Bravo', 'shared-device'); disconnect(original);
        const other = visitor('Charlie', 'account-charlie', 'shared-device');
        cmd(other, 'join', [channel]); cmd(owner, 'op', ['Charlie'], channel, { personNamed: true });
        expect(room().opAccounts.get('shared-device')).toBe('account-charlie');
        cmd(owner, 'cohost', ['remove', 'account-bravo'], channel, { cohostAccount: true, roomInstance: room().keepRef });
        expect(room().ops.has('shared-device')).toBe(true);
        expect(room().opAccounts.get('shared-device')).toBe('account-charlie');
        cmd(other, 'topic', ['New grant belongs to another verified account']);
        expect(room().topic).toBe('New grant belongs to another verified account');
    });

    it('does not infer legacy offline grant ownership from a retained display label', () => {
        const owner = registeredRoom();
        const original = overlappingCohost(owner, 'Bravo', 'offline-device'); disconnect(original);
        const saved = engine.roomSnapshot(), sessions = engine.sessionSnapshot(), live = [...identities.values()];
        delete saved.rooms[0].opAccounts; // Existing durable rows predate proved grant associations.
        boot(); engine.restoreRooms(saved); engine.restoreSessions(sessions, live);
        const unrelated = visitor('Bravo', 'account-unrelated', 'different-device');
        cmd(unrelated, 'join', [channel]); cmd(owner, 'op', ['Bravo'], channel, { personNamed: true });

        cmd(owner, 'cohost', ['remove', 'account-bravo'], channel, { cohostAccount: true, roomInstance: room().keepRef });

        expect(room().cohosts.has('account-bravo')).toBe(false);
        // Legacy records have no historical proof. Unknown grants cannot be
        // attributed from an old nickname or silently reassigned.
        expect(room().ops.has('offline-device')).toBe(true);
        expect(room().ops.has('different-device')).toBe(true);
        cmd(unrelated, 'topic', ['Unrelated nickname holder keeps its own grant']);
        expect(room().topic).toBe('Unrelated nickname holder keeps its own grant');
    });

    it.each([
        null,
        { 'device-Bravo': 'account-bravo' },
        [['ungranted-device', 'account-bravo']],
        [['device-Bravo', 'account-bravo'], ['device-Bravo', 'another-account']],
        [['device-Bravo', 'account with spaces']],
        [['device-Bravo', 'account-bravo', 'unbounded-extra-field']]
    ].map(bindings => ({ bindings })))('fails closed on malformed or unbounded stored grant associations ($bindings)', ({ bindings }) => {
        const owner = registeredRoom(); overlappingCohost(owner);
        const saved = engine.roomSnapshot(); saved.rooms[0].opAccounts = bindings;
        boot(); engine.restoreRooms(saved);
        expect(engine.adminState().lock).toBe('readonly');
        expect(engine._debug.channels.has(channel)).toBe(false);
    });
});
