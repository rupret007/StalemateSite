// @vitest-environment node
// Actual ordinary-mode engine. Trusted connection identities and a deterministic
// clock are explicit unit fixtures, not hosted authentication or C3 consent proof.
import { beforeEach, describe, expect, it } from 'vitest';
import { createLobby, LOBBY_LIMITS } from '../../hangout-worker/src/lobby-core.mjs';

let now, engine, frames, closed, serial;
const receive = (actor, frame) => engine.message(actor.id, JSON.stringify(frame));
const session = actor => engine.sessionSnapshot().connections.find(row => row.id === actor.id);
const room = name => engine.adminState().rooms.find(row => row.name === name);
const storedRoom = name => engine.roomSnapshot().rooms.find(row => row.name === name);
const prefs = actor => { const row = session(actor); return { names: row.ignores, peers: row.ignoredPeerIds || [] }; };
const typed = (actor, text, ch = '#stalemate') => { now += 2000; return receive(actor, { t: 'say', ch, text }); };
const chat = (actor, text, ch = '#stalemate') => { now += 5000; return receive(actor, { t: 'say', ch, text }); };
const selected = (peer, name = 'query', ch = '#stalemate', args = ['Original']) => ({
    t: 'cmd', name, args, ch, roomInstance: room(ch).keepRef, personContext: 1, personPeer: peer.id
});
async function guest(nick, extra = {}, accepted = true) {
    const id = `connection-${++serial}`;
    const identity = { id, dev: `private-device-${serial}`, iph: `private-network-${serial}`, role: 'fan', account: '', admin: false, ...extra };
    const start = frames.length;
    const admission = await engine.connect(identity);
    await receive(identity, { t: 'hello', nick, age13: true });
    if (accepted) { expect(admission).toMatchObject({ ok: true }); expect(frames.slice(start).some(frame => frame.recipient === id && frame.t === 'welcome' && frame.nick === nick)).toBe(true); }
    return { ...identity, admission };
}
async function reusedName() {
    const actor = await guest('Actor'), original = await guest('Original'), successor = await guest('Successor');
    now += 180000;
    const held = selected(original);
    await typed(original, '/nick RenamedOriginal'); await typed(successor, '/nick Original');
    expect(session(original).nick).toBe('RenamedOriginal'); expect(session(successor).nick).toBe('Original');
    expect(session(original).channels).toContain('#stalemate'); expect(session(actor).channels).toContain('#stalemate');
    return { actor, original, successor, held };
}
beforeEach(() => {
    now = 1800000000000; frames = []; closed = []; serial = 0;
    engine = createLobby({ now: () => now, send: (recipient, frame) => frames.push({ recipient, ...structuredClone(frame) }),
        close: (id, code, reason) => closed.push({ id, code, reason }) });
});

describe('selected public person actions', () => {
    it('advertises the exact capability and per-recipient public author identity without publishing private identity fields', async () => {
        const author = await guest('Original', { account: 'private-account-original' }), witness = await guest('Witness');
        expect(frames.find(frame => frame.recipient === author.id && frame.t === 'hello').features.personTargets).toBe(1);
        expect(frames.find(frame => frame.recipient === author.id && frame.t === 'welcome').id).toBe(author.id);
        now += 180000; frames = [];
        const text = 'The public author remains the original endpoint'; await chat(author, text);
        const copies = frames.filter(frame => frame.t === 'line' && frame.text === text);
        expect(copies.map(frame => frame.recipient).sort()).toEqual([author.id, witness.id].sort());
        for (const copy of copies) {
            expect(copy.personPeer).toBe(author.id); expect(copy.personSelf).toBe(copy.recipient === author.id);
            expect(copy.roomInstance).toBe(room('#stalemate').keepRef);
            expect(copy).not.toHaveProperty('dev'); expect(copy).not.toHaveProperty('account'); expect(copy).not.toHaveProperty('authorDev');
            expect(JSON.stringify(copy)).not.toContain(author.dev); expect(JSON.stringify(copy)).not.toContain(author.account);
        }
        expect(new Set(copies.map(frame => frame.id)).size).toBe(1);
        await receive(witness, { t: 'report', id: copies[0].id, text });
        expect(frames.some(frame => frame.recipient === witness.id && frame.t === 'report-status' && frame.submitted === true)).toBe(true);
    });

    it('uses the held original endpoint for a new PM request after its nickname is reclaimed', async () => {
        const { actor, original, successor, held } = await reusedName();
        expect(engine.sessionSnapshot().pendingPm).toEqual([]); expect(engine.sessionSnapshot().pm).toEqual([]);
        frames = []; await receive(actor, held);
        expect(frames.filter(frame => frame.t === 'pm-request').map(frame => frame.recipient)).toEqual([original.id]);
        expect(frames.some(frame => frame.recipient === successor.id && ['pm', 'pm-request', 'pm-open'].includes(frame.t))).toBe(false);
        expect(engine.sessionSnapshot().pendingPm).toEqual([expect.objectContaining({ fromId: actor.id, toId: original.id })]);
        await engine.disconnect(original.id); expect(engine.sessionSnapshot().pendingPm).toEqual([]);
        expect(session(successor).nick).toBe('Original'); frames = [];
        await receive(actor, held);
        expect(frames.filter(frame => ['pm-request', 'pm-open', 'pm'].includes(frame.t))).toEqual([]);
    });

    it.each([
        ['both selected fields absent', { personContext: undefined, personPeer: undefined }],
        ['peer absent', { personPeer: undefined }],
        ['marker absent', { personContext: undefined }],
        ['boolean marker', { personContext: true }],
        ['empty peer', { personPeer: '' }],
        ['non-string peer', { personPeer: 1 }],
        ['unknown peer', { personPeer: 'unconnected-endpoint' }],
        ['nonce absent', { roomInstance: undefined }],
        ['wrong nonce', { roomInstance: '0'.repeat(32) }],
        ['malformed nonce', { roomInstance: 'not-a-room-nonce' }],
        ['origin absent', { ch: undefined }],
        ['unknown origin', { ch: '#not-created' }],
        ['private origin', { ch: 'pm:unrelated-context' }],
        ['mixed deliberate named intent', { personNamed: true }],
        ['mixed private peer fields', state => ({ pmPeer: state.original.id, pmRef: '1'.repeat(32) })],
        ['mixed private explicit intent', { pmExplicit: true }]
    ])('refuses %s without selecting the new nickname holder', async (_label, damage) => {
        const state = await reusedName(); const { actor, original, successor, held } = state;
        frames = []; await receive(actor, { ...held, ...(typeof damage === 'function' ? damage(state) : damage) });
        expect(frames.filter(frame => ['pm-request', 'pm-open', 'pm'].includes(frame.t))).toEqual([]);
        expect(engine.sessionSnapshot().pendingPm).toEqual([]);
        expect(session(successor).nick).toBe('Original');
        // The same eligible actor/peer/context still succeeds when repaired;
        // absence of delivery above is not a global read-only or age refusal.
        frames = []; await receive(actor, held);
        expect(frames.filter(frame => frame.t === 'pm-request').map(frame => frame.recipient)).toEqual([original.id]);
    });

    it('keeps ordinary mode changes usable while ambiguous rank/query frames refuse and explicit named intent works', async () => {
        const host = await guest('Host'), peer = await guest('Peer'); const channel = '#art-person-modes';
        await typed(host, `/join ${channel}`); await typed(peer, `/join ${channel}`); now += 180000;
        expect(storedRoom(channel).ops).toContain(host.dev);
        await receive(host, { t: 'cmd', name: 'mode', args: ['-C'], ch: channel }); expect(room(channel).modes.C).toBe(false);
        await receive(host, { t: 'cmd', name: 'mode', args: ['+C'], ch: channel }); expect(room(channel).modes.C).toBe(true);
        await receive(host, { t: 'cmd', name: 'mode', args: ['+S', '4'], ch: channel }); expect(room(channel).modes.S).toBe(4);
        await receive(host, { t: 'cmd', name: 'mode', args: ['+v', 'Peer'], ch: channel }); expect(storedRoom(channel).voice).not.toContain(peer.dev);
        frames = []; await receive(host, { t: 'cmd', name: 'query', args: ['Peer'], ch: channel });
        expect(frames.some(frame => frame.t === 'pm-request')).toBe(false);
        await typed(host, '/voice Peer', channel); expect(storedRoom(channel).voice).toContain(peer.dev);
        await receive(host, { t: 'cmd', name: 'devoice', args: ['Peer'], ch: channel, personNamed: true });
        expect(storedRoom(channel).voice).not.toContain(peer.dev);
        await typed(host, '/query Peer', channel);
        expect(frames.filter(frame => frame.t === 'pm-request').map(frame => frame.recipient)).toEqual([peer.id]);
    });

    it('bans only the selected original device/account and leaves its successor and shared network unaffected', async () => {
        const admin = await guest('Reviewer', { role: 'band', admin: true });
        const original = await guest('Original', { account: 'private-account-original', iph: 'shared-network' });
        const successor = await guest('Successor', { iph: 'shared-network' }), neighbour = await guest('Neighbour', { iph: 'shared-network' });
        now += 180000; const held = selected(original, 'gban', '#stalemate', ['Original', 'A selected-person reason']);
        await typed(original, '/nick RenamedOriginal'); await typed(successor, '/nick Original');
        await receive(admin, held);
        expect(session(original)).toBeUndefined(); expect(closed.some(row => row.id === original.id)).toBe(true);
        expect(session(successor).nick).toBe('Original'); expect(session(neighbour)).toBeDefined();
        const masks = engine.snapshot().bans.map(row => row.mask);
        expect(masks).toContain(`dev:${original.dev}`); expect(masks).toContain(`account:${original.account}`);
        expect(masks.some(mask => mask.startsWith('nick:') || mask.startsWith('iph:'))).toBe(false);
        await guest('NewNeighbour', { iph: 'shared-network' });
        for (const [name, identity] of [['OriginalDeviceRetry', { dev: original.dev }], ['OriginalAccountRetry', { account: original.account }]]) {
            const retry = await guest(name, identity, false);
            expect(session(retry)).toBeUndefined(); expect(retry.admission).toMatchObject({ ok: false, status: 403, reason: 'banned' });
        }
    });

    it('removes only one exact case-sensitive stored mask and never broadcasts its private value', async () => {
        const admin = await guest('Reviewer', { role: 'band', admin: true });
        const one = await guest('One', { dev: 'CaseSensitiveOriginal' }), two = await guest('Two', { dev: 'IndependentOther' }); now += 180000;
        await receive(admin, selected(one, 'gban', '#stalemate', ['One', 'First independent reason']));
        await receive(admin, selected(two, 'gban', '#stalemate', ['Two', 'Second independent reason']));
        const mask = `dev:${one.dev}`, otherMask = `dev:${two.dev}`, instance = room('#stalemate').keepRef;
        expect(engine.snapshot().bans.map(row => row.mask)).toEqual(expect.arrayContaining([mask, otherMask]));
        const before = structuredClone(engine.snapshot().bans);
        await receive(admin, { t: 'cmd', name: 'unban', args: [mask.toLowerCase()], ch: '#stalemate', roomInstance: instance });
        expect(engine.snapshot().bans).toEqual(before);
        frames = []; await receive(admin, { t: 'cmd', name: 'unban', args: [mask], ch: '#stalemate', roomInstance: instance });
        expect(engine.snapshot().bans.map(row => row.mask)).toContain(otherMask);
        expect(engine.snapshot().bans.map(row => row.mask)).not.toContain(mask);
        const events = frames.filter(frame => frame.t === 'event'); expect(events.length).toBeGreaterThan(0);
        for (const event of events) { expect(event.text).not.toContain(mask); expect(event.text).not.toContain(one.dev); expect(event.text).not.toContain(two.dev); }
        await guest('OneReturns', { dev: one.dev });
        const denied = await guest('TwoStillBlocked', { dev: two.dev }, false);
        expect(session(denied)).toBeUndefined(); expect(denied.admission).toMatchObject({ ok: false, status: 403, reason: 'banned' });
    });

    it('confirms identity Ignore only to its caller, preserves named rules, follows rename and prunes a departed peer', async () => {
        const actor = await guest('Actor'), original = await guest('Original', { account: 'private-ignore-account' }), successor = await guest('Successor'); now += 180000;
        await typed(actor, '/ignore NamedRule'); frames = [];
        await receive(actor, selected(original, 'ignore'));
        const snapshots = frames.filter(frame => frame.t === 'person-preferences'); expect(snapshots).toHaveLength(1);
        expect(snapshots[0]).toEqual({ recipient: actor.id, t: 'person-preferences', names: ['namedrule'], peers: [original.id] });
        expect(JSON.stringify(snapshots)).not.toContain(original.dev); expect(JSON.stringify(snapshots)).not.toContain(original.account);
        await typed(original, '/nick RenamedOriginal'); await typed(successor, '/nick Original');
        frames = []; await chat(original, 'The selected ignored identity is hidden after rename');
        expect(frames.some(frame => frame.recipient === original.id && frame.t === 'line')).toBe(true);
        expect(frames.some(frame => frame.recipient === actor.id && frame.t === 'line')).toBe(false);
        frames = []; await chat(successor, 'The successor can still speak independently');
        expect(frames.some(frame => frame.recipient === actor.id && frame.t === 'line')).toBe(true);
        await receive(actor, selected(original, 'unignore', '#stalemate', ['RenamedOriginal']));
        expect(prefs(actor)).toEqual({ names: ['namedrule'], peers: [] });
        await receive(actor, selected(original, 'ignore', '#stalemate', ['RenamedOriginal']));
        frames = []; await engine.disconnect(original.id);
        expect(prefs(actor)).toEqual({ names: ['namedrule'], peers: [] });
        expect(frames.some(frame => frame.recipient === actor.id && frame.t === 'person-preferences' && frame.peers.length === 0)).toBe(true);
        expect(session(successor).nick).toBe('Original');
    });

    it('shares the existing fifty-entry ceiling between named and selected-identity ignores', async () => {
        const actor = await guest('Actor'), one = await guest('One'), two = await guest('Two'); now += 180000;
        for (let i = 0; i < 49; i++) await typed(actor, `/ignore Rule${i}`);
        expect(prefs(actor).names).toHaveLength(49); expect(prefs(actor).peers).toEqual([]);
        await receive(actor, selected(one, 'ignore', '#stalemate', ['One'])); expect(prefs(actor).peers).toEqual([one.id]);
        await receive(actor, selected(two, 'ignore', '#stalemate', ['Two']));
        expect(prefs(actor).names).toHaveLength(49); expect(prefs(actor).peers).toEqual([one.id]);
        await typed(actor, '/ignore OneMoreNamedRule'); expect(prefs(actor).names).toHaveLength(49);
        await typed(actor, '/unignore Rule0');
        await receive(actor, selected(two, 'ignore', '#stalemate', ['Two']));
        expect(prefs(actor).names).toHaveLength(48); expect(prefs(actor).peers.sort()).toEqual([one.id, two.id].sort());
        expect(prefs(actor).names.length + prefs(actor).peers.length).toBe(50);
    });

    it('refuses a held room action after recreation and permits the exact current incarnation', async () => {
        const host = await guest('Host'), peer = await guest('Peer'); const channel = '#person-room';
        await typed(host, `/join ${channel}`); await typed(peer, `/join ${channel}`); now += 180000;
        const held = selected(peer, 'kick', channel, ['Peer', 'Selected original room']);
        await typed(host, '/close', channel); now += LOBBY_LIMITS.roomPerDevice;
        await typed(host, `/join ${channel}`); await typed(peer, `/join ${channel}`);
        expect(room(channel).keepRef).not.toBe(held.roomInstance); expect(session(peer).channels).toContain(channel);
        await receive(host, held); expect(session(peer).channels).toContain(channel);
        await receive(host, { ...held, roomInstance: room(channel).keepRef }); expect(session(peer).channels).not.toContain(channel);
    });

    it('removes an exact verified cohost account without falling back to the reused nickname', async () => {
        const owner = await guest('Owner', { account: 'account-owner' }), original = await guest('Friend', { account: 'account-original' });
        const successor = await guest('Successor', { account: 'account-successor' }), channel = '#verified-cohosts';
        await typed(owner, `/join ${channel}`); await typed(original, `/join ${channel}`); await typed(successor, `/join ${channel}`);
        await typed(owner, '/register', channel); await typed(owner, '/cohost add Friend', channel);
        expect(storedRoom(channel).cohosts).toContain(original.account);
        now += 180000; await typed(original, '/nick RenamedFriend'); await typed(successor, '/nick Friend');
        await typed(owner, '/cohost add Friend', channel); expect(storedRoom(channel).cohosts).toEqual(expect.arrayContaining([original.account, successor.account]));
        const frame = { t: 'cmd', name: 'cohost', args: ['remove', original.account], ch: channel, roomInstance: room(channel).keepRef, cohostAccount: true };
        await receive(owner, { ...frame, roomInstance: '0'.repeat(32) }); expect(storedRoom(channel).cohosts).toContain(original.account);
        await receive(owner, frame); expect(storedRoom(channel).cohosts).toEqual([successor.account]);
        await receive(owner, { ...frame, args: ['remove', 'Friend'] }); expect(storedRoom(channel).cohosts).toEqual([successor.account]);
    });
});


describe('selected-person context across a same-WebSocket wake', () => {
    it('preserves the saved lobby nonce and lets the unchanged original context Unignore its exact live peer without a refresh or contact grant', async () => {
        const actor = await guest('Actor'), original = await guest('Original'); now += 180000;
        const originalNonce = room('#stalemate').keepRef;
        const held = selected(original, 'ignore', '#stalemate', ['Original']);
        await receive(actor, held);
        expect(prefs(actor)).toEqual({ names: [], peers: [original.id] });
        const saved = structuredClone({ net: engine.snapshot(), rooms: engine.roomSnapshot(), abuse: engine.abuseSnapshot(), sessions: engine.sessionSnapshot() });
        expect(saved.sessions.lobbyInstance).toBe(originalNonce);
        expect(saved.sessions.pm).toEqual([]); expect(saved.sessions.pendingPm).toEqual([]);
        const live = [actor, original].map(({ admission, ...identity }) => identity);
        now += 61000; frames = [];
        engine = createLobby({ now: () => now, send: (recipient, frame) => frames.push({ recipient, ...structuredClone(frame) }),
            close: (id, code, reason) => closed.push({ id, code, reason }) });
        engine.restore(saved.net); await engine.restoreRooms(saved.rooms); engine.restoreAbuse(saved.abuse);
        expect(engine.restoreSessions(saved.sessions, live)).toEqual({ resumed: [actor.id, original.id], rejected: [] });
        expect(room('#stalemate').keepRef).toBe(originalNonce);
        expect(engine.sessionSnapshot().lobbyInstance).toBe(originalNonce);
        expect(prefs(actor)).toEqual({ names: [], peers: [original.id] });
        expect(frames.filter(frame => frame.t === 'person-preferences')).toEqual([
            { recipient: actor.id, t: 'person-preferences', names: [], peers: [original.id] }
        ]);
        expect(frames.filter(frame => ['hello', 'welcome', 'join', 'chan', 'line', 'pm'].includes(frame.t))).toEqual([]);
        // Reuse the exact original command context, changing only its action.
        // No new room projection, nickname selection, handshake or consent.
        frames = []; await receive(actor, { ...held, name: 'unignore' });
        expect(prefs(actor)).toEqual({ names: [], peers: [] });
        expect(frames.filter(frame => frame.t === 'person-preferences')).toEqual([
            { recipient: actor.id, t: 'person-preferences', names: [], peers: [] }
        ]);
        await chat(original, 'The original peer is heard after confirmed Unignore across wake');
        expect(frames.some(frame => frame.recipient === actor.id && frame.t === 'line'
            && frame.personPeer === original.id && frame.roomInstance === originalNonce
            && frame.text === 'The original peer is heard after confirmed Unignore across wake')).toBe(true);
        expect(engine.sessionSnapshot().pm).toEqual([]); expect(engine.sessionSnapshot().pendingPm).toEqual([]);
        expect(frames.filter(frame => ['pm', 'pm-open', 'pm-request'].includes(frame.t))).toEqual([]);
        expect(closed).toEqual([]);
    });
});
