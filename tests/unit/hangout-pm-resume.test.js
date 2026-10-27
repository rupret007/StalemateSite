// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';

let now, engine, frames, identities, sequence;
const cmd = (id, name, args = []) => engine.message(id, JSON.stringify({ t: 'cmd', name, args, ch: '#stalemate' }));
function boot() { frames = []; engine = createLobby({ now: () => now, send: (recipient, f) => frames.push({ recipient, ...f }), limits: { defaultSlow: 0 } }); }
function guest(nick, extra = {}) {
    const identity = { id: `socket${++sequence}`, dev: `dev-${nick}`, iph: `ip-${sequence}`, role: 'fan', account: '', admin: false, ...extra };
    identities.push(identity); engine.connect(identity); engine.message(identity.id, JSON.stringify({ t: 'hello', nick, age13: true })); return identity.id;
}
function saved() { return structuredClone({ sessions: engine.sessionSnapshot(), rooms: engine.roomSnapshot(), net: engine.snapshot() }); }
function wake(snapshot, live = identities, sleep = 61000) {
    now += sleep; boot(); engine.restore(snapshot.net); engine.restoreRooms(snapshot.rooms);
    return engine.restoreSessions(snapshot.sessions, live);
}
function request() {
    const sender = guest('Sender'); const recipient = guest('Recipient'); now += 180000;
    cmd(sender, 'msg', ['Recipient', 'A first message that must never be saved']);
    return { sender, recipient, snapshot: saved() };
}
beforeEach(() => { now = 1800000000000; identities = []; sequence = 0; boot(); });

describe('pending PM consent across a same-socket wake', () => {
    it('preserves only metadata, lets the existing Accept work and tells both sides to resend the lost first text', () => {
        const { sender, recipient, snapshot } = request();
        const ref = frames.find(frame => frame.recipient === recipient && frame.t === 'pm-request').ref;
        expect(ref).toMatch(/^[a-f0-9]{32}$/);
        expect(snapshot.sessions.pendingPm).toEqual([{ key: [sender, recipient].sort().join('|'), from: 'dev-Sender',
            fromId: sender, toId: recipient, at: now, hadFirst: true, ref }]);
        expect(JSON.stringify(snapshot.sessions)).not.toContain('A first message');
        expect(wake(snapshot).resumed).toEqual([sender, recipient]); expect(frames).toEqual([]);
        cmd(recipient, 'accept', ['Sender']);
        expect(frames.filter((f) => f.t === 'pm-open')).toHaveLength(2);
        expect(frames.filter((f) => f.t === 'pm')).toEqual([]);
        for (const id of [sender, recipient]) expect(frames.some((f) => f.recipient === id && /first message was not retained/.test(f.text || ''))).toBe(true);
        cmd(sender, 'msg', ['Recipient', 'The explicitly resent first message']);
        expect(frames.some((f) => f.recipient === recipient && f.t === 'pm' && f.text === 'The explicitly resent first message')).toBe(true);
        expect(engine.sessionSnapshot().pendingPm).toEqual([]);
    });

    it('keeps normal delivery before wake and does not invent lost text for a query-only request', () => {
        const { sender, recipient } = request(); cmd(recipient, 'accept', ['Sender']);
        expect(frames.some((f) => f.recipient === recipient && f.t === 'pm' && f.text.startsWith('A first message'))).toBe(true);
        const other = guest('Other'); cmd(sender, 'query', ['Other']);
        const snapshot = saved(); expect(snapshot.sessions.pendingPm[0].hadFirst).toBe(false);
        wake(snapshot); cmd(other, 'accept', ['Sender']);
        expect(frames.filter((f) => f.t === 'pm-open')).toHaveLength(2);
        expect(frames.some((f) => /not retained/.test(f.text || ''))).toBe(false);
    });

    it('retains the original expiry and lost-first marker over repeated wakes', () => {
        const { recipient, snapshot } = request(); const at = snapshot.sessions.pendingPm[0].at;
        wake(snapshot); const second = saved(); expect(second.sessions.pendingPm[0]).toMatchObject({ at, hadFirst: true });
        wake(second); cmd(recipient, 'accept', ['Sender']);
        expect(frames.some((f) => /first message was not retained/.test(f.text || ''))).toBe(true);
    });

    it('updates an existing request prompt after a nickname change while keeping the same sender endpoint', () => {
        const { sender, recipient } = request(); now += 61000; cmd(sender, 'nick', ['Renamed']);
        expect(frames.some((f) => f.recipient === recipient && f.t === 'pm-request-ended' && f.from === 'Sender')).toBe(true);
        expect(frames.some((f) => f.recipient === recipient && f.t === 'pm-request' && f.from === 'Renamed')).toBe(true);
        wake(saved()); cmd(recipient, 'accept', ['Renamed']);
        expect(frames.filter((f) => f.t === 'pm-open')).toHaveLength(2);
    });

    it.each(['blocked', 'ignored', 'PMs off'])('refuses a restored request when the recipient has %s', (policy) => {
        const { recipient, snapshot } = request(); const target = snapshot.sessions.connections.find((c) => c.id === recipient);
        if (policy === 'blocked') target.blocks.push('dev-Sender');
        if (policy === 'ignored') target.ignores.push('sender');
        if (policy === 'PMs off') target.pmOff = true;
        wake(snapshot); cmd(recipient, 'accept', ['Sender']);
        expect(engine._debug.pm.size).toBe(0); expect(frames.some((f) => f.t === 'pm-open' || f.t === 'pm')).toBe(false);
        expect(frames.some((f) => f.recipient === recipient && f.t === 'pm-request-ended')).toBe(true);
    });

    it('rechecks ignore/block/preferences at acceptance rather than relying on the earlier request', () => {
        const { sender, recipient, snapshot } = request(); wake(snapshot);
        cmd(recipient, 'ignore', ['Sender']); cmd(recipient, 'accept', ['Sender']);
        expect(engine._debug.pm.size).toBe(0); expect(frames.some((f) => f.t === 'pm-open')).toBe(false);
        cmd(recipient, 'unignore', ['Sender']); cmd(sender, 'query', ['Recipient']);
        cmd(recipient, 'pm', ['off']);
        expect(frames.some((f) => f.t === 'pm-request-ended' && /turned off/.test(f.reason || ''))).toBe(true);
    });

    it('expires requests after ten minutes and removes the stale visible prompt', () => {
        const { recipient, snapshot } = request(); wake(snapshot, identities, 10 * 60000);
        expect(engine._debug.pm.size).toBe(0);
        expect(frames.some((f) => f.recipient === recipient && f.t === 'pm-request-ended')).toBe(true);
        cmd(recipient, 'accept', ['Sender']); expect(frames.some((f) => f.t === 'pm-open')).toBe(false);
    });

    it('removes expired pending text in an active process and permits a fresh request', () => {
        const { sender, recipient } = request(); now += 10 * 60000; engine.tick();
        expect(engine._debug.pm.size).toBe(0);
        expect(frames.some((f) => f.recipient === recipient && f.t === 'pm-request-ended')).toBe(true);
        cmd(sender, 'query', ['Recipient']); expect(engine._debug.pm.size).toBe(1);
    });

    it('does not let a different connection on the same signed device accept the request', () => {
        const { recipient, snapshot } = request(); wake(snapshot);
        const other = guest('SameDevice', { dev: 'dev-Recipient' }); cmd(other, 'accept', ['Sender']);
        expect(frames.some((f) => f.t === 'pm-open')).toBe(false);
        cmd(recipient, 'accept', ['Sender']); expect(frames.filter((f) => f.t === 'pm-open')).toHaveLength(2);
    });

    it('does not transfer a pending request to a reconnect using the old device and nickname', () => {
        const { sender, recipient, snapshot } = request();
        expect(wake(snapshot, identities.filter((c) => c.id !== sender)).resumed).toEqual([recipient]);
        expect(engine._debug.pm.size).toBe(0);
        expect(frames.some((f) => f.recipient === recipient && f.t === 'pm-request-ended')).toBe(true);
        guest('Sender', { dev: 'dev-Sender' }); cmd(recipient, 'accept', ['Sender']);
        expect(frames.some((f) => f.t === 'pm-open')).toBe(false);
    });

    it('clears accepted consent on a real disconnect, while a later reconnect must ask again', () => {
        const { sender, recipient } = request(); cmd(recipient, 'accept', ['Sender']);
        engine.disconnect(sender); expect(engine._debug.pm.size).toBe(0);
        frames = []; const returning = guest('Sender', { dev: 'dev-Sender' }); now += 180000;
        cmd(returning, 'query', ['Recipient']);
        expect(frames.some((f) => f.recipient === recipient && f.t === 'pm-request')).toBe(true);
        expect(frames.some((f) => f.t === 'pm-open')).toBe(false);
    });

    it('does not give another simultaneous tab on the same signed device accepted PM consent', () => {
        const { sender, recipient } = request(); cmd(recipient, 'accept', ['Sender']);
        const other = guest('AnotherTab', { dev: 'dev-Sender' }); now += 180000; frames = [];
        cmd(other, 'msg', ['Recipient', 'This requires independent consent']);
        expect(frames.some((f) => f.t === 'pm')).toBe(false);
        expect(frames.some((f) => f.recipient === recipient && f.t === 'pm-request' && f.from === 'AnotherTab')).toBe(true);
        cmd(sender, 'msg', ['Recipient', 'The original connection still has consent']);
        expect(frames.some((f) => f.recipient === recipient && f.t === 'pm' && /original connection/.test(f.text))).toBe(true);
    });

    it('does not resurrect legacy device-pair consent when exact endpoint metadata is missing', () => {
        const { sender, recipient } = request(); cmd(recipient, 'accept', ['Sender']); const snapshot = saved();
        snapshot.sessions.pm = [{ key: 'dev-Recipient|dev-Sender', from: 'dev-Sender', state: 'open' }];
        expect(wake(snapshot).resumed).toHaveLength(2); expect(engine._debug.pm.size).toBe(0);
    });

    it.each([
        ['missing', undefined], ['empty', [{}]], ['oversized', Array(1001).fill({})],
        ['future', 'future'], ['wrong sender', 'from'], ['wrong pair', 'key'], ['missing recipient', 'toId'], ['missing text marker', 'hadFirst']
    ])('fails closed for %s metadata without restarting otherwise valid connections', (_label, damage) => {
        const { snapshot } = request();
        if (typeof damage === 'string') {
            if (damage === 'future') snapshot.sessions.pendingPm[0].at = now + 999999;
            else if (damage === 'hadFirst') delete snapshot.sessions.pendingPm[0].hadFirst;
            else snapshot.sessions.pendingPm[0][damage] = 'tampered';
        } else snapshot.sessions.pendingPm = damage;
        expect(wake(snapshot).resumed).toHaveLength(2); expect(engine._debug.pm.size).toBe(0);
    });
});


describe('accepted PM endpoint teardown', () => {
    it.each(['sender', 'recipient'])('notifies only the surviving original endpoint when the %s disconnects', (leaving) => {
        const { sender, recipient } = request();
        cmd(recipient, 'accept', ['Sender']);
        const observer = guest('Observer');
        expect(engine._debug.pm.size).toBe(1);
        const departing = leaving === 'sender' ? sender : recipient;
        const survivor = leaving === 'sender' ? recipient : sender;
        const departedNick = leaving === 'sender' ? 'Sender' : 'Recipient';
        const ref = frames.find(frame => frame.recipient === survivor && frame.t === 'pm-open').ref;
        expect(ref).toMatch(/^[a-f0-9]{32}$/);
        frames = [];
        engine.disconnect(departing);
        expect(engine._debug.pm.size).toBe(0);
        expect(frames.filter(frame => frame.t === 'pm-closed')).toEqual([
            { recipient: survivor, t: 'pm-closed', with: departedNick, peer: departing, ref }
        ]);
        expect(frames.some(frame => frame.t === 'pm-closed' && [departing, observer].includes(frame.recipient))).toBe(false);
        frames = [];
        engine.disconnect(departing);
        expect(frames.filter(frame => frame.t === 'pm-closed')).toEqual([]);
    });

    it.each(['the same signed device', 'a different signed device'])('requires fresh consent after the old nickname is reused by %s', (device) => {
        const { sender, recipient } = request();
        cmd(recipient, 'accept', ['Sender']);
        const observer = guest('Observer');
        engine.disconnect(sender);
        const replacement = guest('Sender', { dev: device === 'the same signed device' ? 'dev-Sender' : 'dev-Replacement' });
        expect(replacement).not.toBe(sender);
        now += 180000; frames = [];
        cmd(recipient, 'accept', ['Sender']);
        expect(frames.some(frame => frame.t === 'pm-open' || frame.t === 'pm')).toBe(false);
        const text = 'Only this new endpoint asks to send this new body';
        frames = [];
        cmd(replacement, 'msg', ['Recipient', text]);
        const freshRequest = frames.find(frame => frame.recipient === recipient && frame.t === 'pm-request');
        expect(freshRequest.ref).toMatch(/^[a-f0-9]{32}$/);
        expect(frames.filter(frame => frame.t === 'pm-request')).toEqual([
            { recipient, t: 'pm-request', from: 'Sender', band: false, peer: replacement, ref: freshRequest.ref }
        ]);
        expect(frames.some(frame => frame.t === 'pm-open' || frame.t === 'pm' || frame.t === 'pm-closed')).toBe(false);
        frames = [];
        cmd(recipient, 'accept', ['Sender']);
        expect(frames.filter(frame => frame.t === 'pm-open').map(frame => frame.recipient).sort()).toEqual([recipient, replacement].sort());
        expect(frames.filter(frame => frame.t === 'pm').map(frame => [frame.recipient, frame.text]).sort()).toEqual([
            [recipient, text], [replacement, text]
        ].sort());
        expect(frames.some(frame => [sender, observer].includes(frame.recipient) && ['pm', 'pm-open', 'pm-closed'].includes(frame.t))).toBe(false);
        expect(frames.some(frame => frame.t === 'pm' && /A first message/.test(frame.text))).toBe(false);
    });
});


describe('accepted PM disconnect commit ordering', () => {
    it('holds the close notification until sessions commit and discards it when that required write rejects', async () => {
        // The real legacy durable wrapper stages outbound frames while its
        // required sessions write is pending. Exercise rejection first so a
        // missing success notification cannot hide the negative-path oracle.
        for (const rejected of [true, false]) {
            const sent = [], heldSessions = [];
            let hold = false, settle;
            const lobby = createLobby({ now: () => now, limits: { defaultSlow: 0 },
                send: (recipient, frame) => sent.push({ recipient, ...frame }),
                persist: (kind, value) => {
                    if (!hold || kind !== 'sessions') return;
                    heldSessions.push(structuredClone(value));
                    return new Promise((resolve, reject) => { settle = { resolve, reject }; });
                } });
            const command = (id, name, args) => lobby.message(id, JSON.stringify({ t: 'cmd', name, args, ch: '#stalemate' }));
            for (const nick of ['Sender', 'Recipient', 'Observer']) {
                lobby.connect({ id: nick, dev: `dev-${nick}`, iph: `ip-${nick}`, role: 'fan', account: '', admin: false });
                await lobby.message(nick, JSON.stringify({ t: 'hello', nick, age13: true }));
            }
            now += 180000;
            await command('Sender', 'query', ['Recipient']);
            await command('Recipient', 'accept', ['Sender']);
            expect(lobby._debug.pm.size).toBe(1);
            const ref = sent.find(frame => frame.recipient === 'Recipient' && frame.t === 'pm-open').ref;
            expect(ref).toMatch(/^[a-f0-9]{32}$/);
            sent.length = 0; hold = true;
            const disconnecting = lobby.disconnect('Sender');
            expect(typeof disconnecting?.then).toBe('function');
            expect(heldSessions).toHaveLength(1);
            expect(heldSessions[0].pm).toEqual([]);
            expect(heldSessions[0].connections.map(connection => connection.id).sort()).toEqual(['Observer', 'Recipient']);
            expect(sent.filter(frame => frame.t === 'pm-closed')).toEqual([]);
            if (rejected) settle.reject(new Error('Actual required sessions write rejected'));
            else settle.resolve();
            await disconnecting;
            expect(sent.filter(frame => frame.t === 'pm-closed')).toEqual(rejected ? [] : [
                { recipient: 'Recipient', t: 'pm-closed', with: 'Sender', peer: 'Sender', ref }
            ]);
            if (rejected) {
                expect(lobby.snapshot().lock).toBe('readonly');
                expect(sent.some(frame => frame.recipient === 'Recipient' && frame.t === 'notice' && /Storage is unavailable/.test(frame.text))).toBe(true);
            }
        }
    });
});


// Binding-aware protocol cases use actual engine admission and server-issued
// references. All previous case titles and behavioral assertions remain above.
function peerGuest(nick, extra = {}) {
    const identity = { id: `socket${++sequence}`, dev: `dev-${nick}`, iph: `ip-${sequence}`, role: 'fan', account: '', admin: false, ...extra };
    identities.push(identity); engine.connect(identity);
    engine.message(identity.id, JSON.stringify({ t: 'hello', nick, age13: true }));
    const hello = frames.find(frame => frame.recipient === identity.id && frame.t === 'hello');
    expect(hello.features.privateMessagePeers).toBe(1);
    return identity.id;
}
function openPeerPair(from, to, fromNick, toNick) {
    frames = []; cmd(from, 'query', [toNick]);
    const request = frames.find(frame => frame.recipient === to && frame.t === 'pm-request');
    expect(request).toMatchObject({ peer: from, from: fromNick });
    expect(request.ref).toMatch(/^[a-f0-9]{32}$/);
    cmd(to, 'accept', [fromNick]);
    const opened = frames.find(frame => frame.recipient === from && frame.t === 'pm-open');
    expect(opened).toMatchObject({ with: toNick, peer: to, ref: request.ref });
    expect(frames.find(frame => frame.recipient === to && frame.t === 'pm-open'))
        .toMatchObject({ with: fromNick, peer: from, ref: request.ref });
    return opened.ref;
}
function boundPeerSend(actor, peer, ref, text, extra = {}) {
    return engine.message(actor, JSON.stringify({ t: 'say', ch: `pm:${ref}`, pmPeer: peer, pmRef: ref, text, ...extra }));
}
function peerTriangle() {
    const sender = peerGuest('Sender'), recipient = peerGuest('Recipient'), other = peerGuest('Other');
    now += 180000;
    const ref = openPeerPair(sender, recipient, 'Sender', 'Recipient');
    const otherRef = openPeerPair(sender, other, 'Sender', 'Other');
    expect(otherRef).not.toBe(ref);
    return { sender, recipient, other, ref, otherRef };
}

describe('PM endpoint references', () => {
    it('keeps implicit text, structured msg and private actions on the original accepted peer after nickname reuse', () => {
        const { sender, recipient, other, ref, otherRef } = peerTriangle();
        now += 61000; cmd(recipient, 'nick', ['Renamed']); cmd(other, 'nick', ['Recipient']);
        frames = [];
        boundPeerSend(sender, recipient, ref, 'Only the original accepted endpoint receives this body', { clientMessageId: '1'.repeat(32) });
        const ordinary = frames.filter(frame => frame.t === 'pm');
        expect(ordinary.map(frame => frame.recipient)).toEqual([sender, recipient]);
        expect(ordinary.every(frame => frame.to === 'Renamed' && frame.text === 'Only the original accepted endpoint receives this body')).toBe(true);
        expect(ordinary.find(frame => frame.recipient === sender)).toMatchObject({ peer: recipient, ref, self: true });
        expect(ordinary.find(frame => frame.recipient === recipient)).toMatchObject({ peer: sender, ref, self: false });
        expect(ordinary.every(frame => !Object.hasOwn(frame, 'clientMessageId'))).toBe(true);
        expect(frames.filter(frame => frame.t === 'message-result')).toEqual([
            { recipient: sender, t: 'message-result', id: '1'.repeat(32), status: 'published' }
        ]);
        for (const [name, args, text] of [
            ['msg', ['Recipient', 'An implicit structured composer stays with the same peer'], 'An implicit structured composer stays with the same peer'],
            ['me', ['keeps this action private with the original peer'], 'keeps this action private with the original peer'],
            ['slap', [], 'slaps Renamed around a bit with a large trout']
        ]) {
            now += 4000; frames = [];
            engine.message(sender, JSON.stringify({ t: 'cmd', name, args, ch: `pm:${ref}`, pmPeer: recipient, pmRef: ref }));
            const delivered = frames.filter(frame => frame.t === 'pm');
            expect(delivered.map(frame => frame.recipient)).toEqual([sender, recipient]);
            expect(delivered.every(frame => frame.to === 'Renamed' && frame.text === text && frame.ref === ref)).toBe(true);
            expect(delivered.some(frame => frame.recipient === other || frame.ref === otherRef)).toBe(false);
        }
        expect(engine._debug.pm.size).toBe(2);
    });

    it.each([
        ['missing peer', { pmPeer: undefined }],
        ['missing reference', { pmRef: undefined }],
        ['empty peer', { pmPeer: '' }],
        ['empty reference', { pmRef: '' }],
        ['nonstring peer', { pmPeer: ['socket'] }],
        ['nonstring reference', { pmRef: 1 }],
        ['unknown peer', { pmPeer: 'unconnected-visitor' }],
        ['forged reference', { pmRef: '0'.repeat(32) }]
    ])('rejects %s without falling back to a current nickname or creating a request', (_label, damage) => {
        const { sender, recipient, other, ref } = peerTriangle();
        now += 61000; cmd(recipient, 'nick', ['Renamed']); cmd(other, 'nick', ['Recipient']);
        const forgedRef = ref === '0'.repeat(32) ? 'f'.repeat(32) : '0'.repeat(32);
        const patch = _label === 'forged reference' ? { pmRef: forgedRef } : damage;
        frames = [];
        // Keep the legitimate context first, then damage only the selected
        // field so a context mismatch cannot mask the peer/reference oracle.
        engine.message(sender, JSON.stringify({ t: 'say', ch: `pm:${ref}`, pmPeer: recipient, pmRef: ref,
            text: 'No endpoint receives this invalid implicit body', clientMessageId: '2'.repeat(32), ...patch }));
        expect(frames.filter(frame => ['pm', 'pm-open', 'pm-request'].includes(frame.t))).toEqual([]);
        expect(frames.filter(frame => frame.t === 'message-result')).toEqual([
            { recipient: sender, t: 'message-result', id: '2'.repeat(32), status: 'rejected' }
        ]);
        expect(engine._debug.pm.size).toBe(2);
    });

    it('does not let another actor or another accepted pair use a copied reference', () => {
        const { sender, recipient, other, ref } = peerTriangle();
        for (const [actor, peer] of [[sender, other], [other, recipient]]) {
            now += 4000; frames = [];
            boundPeerSend(actor, peer, ref, 'A copied reference is not consent for this endpoint', { clientMessageId: '3'.repeat(32) });
            expect(frames.filter(frame => ['pm', 'pm-open', 'pm-request'].includes(frame.t))).toEqual([]);
            expect(frames.filter(frame => frame.t === 'message-result')).toEqual([
                { recipient: actor, t: 'message-result', id: '3'.repeat(32), status: 'rejected' }
            ]);
            expect(engine._debug.pm.size).toBe(2);
        }
    });

    it('keeps pending acceptance tied to the original sender and cannot publish an unaccepted bound body', () => {
        const sender = peerGuest('Sender'), recipient = peerGuest('Recipient'), other = peerGuest('Other');
        now += 180000; frames = []; cmd(sender, 'query', ['Recipient']);
        const pending = frames.find(frame => frame.recipient === recipient && frame.t === 'pm-request');
        expect(pending).toMatchObject({ peer: sender }); expect(pending.ref).toMatch(/^[a-f0-9]{32}$/);
        frames = []; boundPeerSend(sender, recipient, pending.ref, 'This body requires actual acceptance', { clientMessageId: '4'.repeat(32) });
        expect(frames.filter(frame => ['pm', 'pm-open', 'pm-request'].includes(frame.t))).toEqual([]);
        expect(frames.filter(frame => frame.t === 'message-result')).toEqual([
            { recipient: sender, t: 'message-result', id: '4'.repeat(32), status: 'rejected' }
        ]);
        now += 61000; cmd(sender, 'nick', ['Renamed']); cmd(other, 'nick', ['Sender']);
        frames = [];
        const wrongRef = pending.ref === '0'.repeat(32) ? 'f'.repeat(32) : '0'.repeat(32);
        engine.message(recipient, JSON.stringify({ t: 'cmd', name: 'accept', args: ['Sender'], ch: '#stalemate', pmPeer: sender, pmRef: wrongRef }));
        expect(frames.filter(frame => frame.t === 'pm-open')).toEqual([]);
        frames = [];
        engine.message(recipient, JSON.stringify({ t: 'cmd', name: 'accept', args: ['Sender'], ch: '#stalemate', pmPeer: sender, pmRef: pending.ref }));
        expect(frames.filter(frame => frame.t === 'pm-open').map(frame => frame.recipient).sort()).toEqual([sender, recipient].sort());
        expect(frames.find(frame => frame.recipient === recipient && frame.t === 'pm-open')).toMatchObject({ with: 'Renamed', peer: sender, ref: pending.ref });
        expect(frames.some(frame => frame.recipient === other && ['pm-open', 'pm'].includes(frame.t))).toBe(false);
        frames = []; boundPeerSend(recipient, sender, pending.ref, 'Now only the accepted original endpoints exchange this text');
        expect(frames.filter(frame => frame.t === 'pm').map(frame => frame.recipient)).toEqual([recipient, sender]);
    });

    it('rejects an old reference after disconnect and fresh acceptance even when the connection ID is reused', () => {
        const sender = peerGuest('Sender'), recipient = peerGuest('Recipient'); now += 180000;
        const ref = openPeerPair(sender, recipient, 'Sender', 'Recipient');
        frames = []; engine.disconnect(recipient);
        expect(frames.filter(frame => frame.t === 'pm-closed')).toEqual([
            { recipient: sender, t: 'pm-closed', with: 'Recipient', peer: recipient, ref }
        ]);
        const replacement = peerGuest('Replacement', { id: recipient, dev: 'different-signed-device' });
        expect(replacement).toBe(recipient); now += 180000;
        const freshRef = openPeerPair(sender, replacement, 'Sender', 'Replacement');
        expect(freshRef).not.toBe(ref); frames = [];
        boundPeerSend(sender, replacement, ref, 'The old reference must not address this reused ID', { clientMessageId: '5'.repeat(32) });
        expect(frames.filter(frame => ['pm', 'pm-open', 'pm-request'].includes(frame.t))).toEqual([]);
        expect(frames.filter(frame => frame.t === 'message-result')).toEqual([
            { recipient: sender, t: 'message-result', id: '5'.repeat(32), status: 'rejected' }
        ]);
        now += 4000; frames = []; boundPeerSend(sender, replacement, freshRef, 'Fresh acceptance uses only its fresh reference');
        expect(frames.filter(frame => frame.t === 'pm').map(frame => frame.recipient)).toEqual([sender, replacement]);
        expect(frames.filter(frame => frame.t === 'pm').every(frame => frame.ref === freshRef)).toBe(true);
    });

    it('preserves the accepted reference over a same-socket wake without replaying a private body', () => {
        const sender = peerGuest('Sender'), recipient = peerGuest('Recipient'); now += 180000;
        const ref = openPeerPair(sender, recipient, 'Sender', 'Recipient');
        const snapshot = saved();
        expect(snapshot.sessions.pm).toHaveLength(1); expect(snapshot.sessions.pm[0].ref).toBe(ref);
        expect(wake(snapshot).resumed).toEqual([sender, recipient]);
        expect(frames.filter(frame => frame.t === 'pm')).toEqual([]);
        frames = []; boundPeerSend(sender, recipient, ref, 'An explicit new body after the same-socket wake');
        expect(frames.filter(frame => frame.t === 'pm').map(frame => frame.recipient)).toEqual([sender, recipient]);
        expect(frames.filter(frame => frame.t === 'pm').every(frame => frame.ref === ref)).toBe(true);
    });

    it.each(['typed slash command', 'explicit menu command'])('keeps a deliberately named %s separate from the old bound composer', (intent) => {
        const sender = peerGuest('Sender'), recipient = peerGuest('Recipient'), other = peerGuest('Other'); now += 180000;
        const ref = openPeerPair(sender, recipient, 'Sender', 'Recipient');
        now += 61000; cmd(recipient, 'nick', ['Renamed']); cmd(other, 'nick', ['Recipient']);
        const text = 'This deliberate nickname request needs its own fresh consent'; frames = [];
        const command = intent === 'typed slash command'
            ? { t: 'say', ch: `pm:${ref}`, pmPeer: recipient, pmRef: ref, text: `/msg Recipient ${text}` }
            : { t: 'cmd', name: 'msg', args: ['Recipient', text], ch: `pm:${ref}`, pmPeer: recipient, pmRef: ref, pmExplicit: true };
        engine.message(sender, JSON.stringify(command));
        expect(frames.filter(frame => frame.t === 'pm')).toEqual([]);
        expect(frames.filter(frame => frame.t === 'pm-request')).toHaveLength(1);
        const request = frames.find(frame => frame.t === 'pm-request');
        expect(request).toMatchObject({ recipient: other, from: 'Sender', peer: sender }); expect(request.ref).not.toBe(ref);
        frames = []; cmd(other, 'accept', ['Sender']);
        expect(frames.filter(frame => frame.t === 'pm').map(frame => frame.recipient)).toEqual([sender, other]);
        expect(frames.filter(frame => frame.t === 'pm').every(frame => frame.text === text)).toBe(true);
        expect(frames.some(frame => frame.recipient === recipient && ['pm', 'pm-open'].includes(frame.t))).toBe(false);
    });

    it('does not reuse a bound conversation after the current peer blocks the sender', () => {
        const sender = peerGuest('Sender'), recipient = peerGuest('Recipient'); now += 180000;
        const ref = openPeerPair(sender, recipient, 'Sender', 'Recipient');
        frames = []; cmd(recipient, 'block', ['Sender']);
        expect(frames.some(frame => frame.recipient === sender && frame.t === 'pm-closed' && frame.peer === recipient && frame.ref === ref)).toBe(true);
        frames = []; boundPeerSend(sender, recipient, ref, 'A previously accepted reference cannot bypass a current block', { clientMessageId: '6'.repeat(32) });
        expect(frames.filter(frame => ['pm', 'pm-open', 'pm-request'].includes(frame.t))).toEqual([]);
        expect(frames.filter(frame => frame.t === 'message-result')).toEqual([
            { recipient: sender, t: 'message-result', id: '6'.repeat(32), status: 'rejected' }
        ]);
    });


    it.each(['decline'])('binds pending %s to the original sender after its old nickname is reclaimed', (name) => {
        const sender = peerGuest('Sender'), recipient = peerGuest('Recipient'), other = peerGuest('Other');
        now += 180000; frames = []; cmd(sender, 'query', ['Recipient']);
        const request = frames.find(frame => frame.recipient === recipient && frame.t === 'pm-request');
        expect(request).toMatchObject({ peer: sender }); expect(request.ref).toMatch(/^[a-f0-9]{32}$/);
        now += 61000; cmd(sender, 'nick', ['Renamed']); cmd(other, 'nick', ['Sender']);
        frames = [];
        const wrongRef = request.ref === '0'.repeat(32) ? 'f'.repeat(32) : '0'.repeat(32);
        engine.message(recipient, JSON.stringify({ t: 'cmd', name, args: ['Sender'], ch: '#stalemate', pmPeer: sender, pmRef: wrongRef }));
        expect(engine._debug.pm.size).toBe(1);
        expect(engine.sessionSnapshot().connections.find(connection => connection.id === recipient).blocks).toEqual([]);
        frames = [];
        engine.message(recipient, JSON.stringify({ t: 'cmd', name, args: ['Sender'], ch: '#stalemate', pmPeer: sender, pmRef: request.ref }));
        expect(engine._debug.pm.size).toBe(0);
        expect(frames.some(frame => frame.recipient === other && ['pm-closed', 'pm-request-ended', 'pm-open', 'pm'].includes(frame.t))).toBe(false);
        const state = engine.sessionSnapshot().connections.find(connection => connection.id === recipient);
        expect(state.blocks).toEqual(name === 'block' ? ['dev-Sender'] : []);
        expect(state.blocks).not.toContain('dev-Other');
        now += 4000; frames = []; cmd(other, 'query', ['Recipient']);
        expect(frames.find(frame => frame.recipient === recipient && frame.t === 'pm-request')).toMatchObject({ from: 'Sender', peer: other });
    });

    it('does not invent a bound reply grant when an otherwise valid legacy pair has no stored reference', () => {
        const sender = peerGuest('Sender'), recipient = peerGuest('Recipient'); now += 180000;
        const ref = openPeerPair(sender, recipient, 'Sender', 'Recipient');
        const snapshot = saved(); delete snapshot.sessions.pm[0].ref;
        expect(wake(snapshot).resumed).toEqual([sender, recipient]);
        expect(frames.filter(frame => frame.t === 'pm')).toEqual([]);
        frames = []; boundPeerSend(sender, recipient, ref, 'A missing stored reference cannot silently acquire a bound reply', { clientMessageId: '7'.repeat(32) });
        expect(frames.filter(frame => ['pm', 'pm-open', 'pm-request'].includes(frame.t))).toEqual([]);
        expect(frames.filter(frame => frame.t === 'message-result')).toEqual([
            { recipient: sender, t: 'message-result', id: '7'.repeat(32), status: 'rejected' }
        ]);
    });

    it('fails closed on malformed or duplicate stored pair references instead of repairing them into a grant', () => {
        for (const damage of ['malformed', 'duplicate']) {
            // Each iteration has genuinely admitted endpoints/open pairs; this
            // is a stored-corruption boundary, not a normal issuance claim.
            identities = []; sequence = 0; boot();
            const { sender, recipient, ref } = peerTriangle();
            const snapshot = saved(); expect(snapshot.sessions.pm).toHaveLength(2);
            snapshot.sessions.pm[1].ref = damage === 'malformed' ? 'not-a-reference' : ref;
            const result = wake(snapshot);
            expect(result.resumed).toEqual([]);
            expect(engine._debug.pm.size).toBe(0);
            expect(frames.filter(frame => ['pm', 'pm-open'].includes(frame.t))).toEqual([]);
            frames = []; boundPeerSend(sender, recipient, ref, 'Corrupt stored references do not authorize this body');
            expect(frames.filter(frame => ['pm', 'pm-request', 'pm-open'].includes(frame.t))).toEqual([]);
        }
    });


    it('rejects a valid peer and reference in a mismatched context without falling back to that nickname', () => {
        const { sender, recipient, other, ref } = peerTriangle();
        now += 61000; cmd(recipient, 'nick', ['Renamed']); cmd(other, 'nick', ['Recipient']); frames = [];
        engine.message(sender, JSON.stringify({ t: 'say', ch: 'pm:Recipient', pmPeer: recipient, pmRef: ref,
            text: 'A different context is not this bound conversation', clientMessageId: '8'.repeat(32) }));
        expect(frames.filter(frame => ['pm', 'pm-open', 'pm-request'].includes(frame.t))).toEqual([]);
        expect(frames.filter(frame => frame.t === 'message-result')).toEqual([
            { recipient: sender, t: 'message-result', id: '8'.repeat(32), status: 'rejected' }
        ]);
        expect(engine._debug.pm.size).toBe(2);
    });

    it.each(['normal connection', 'restored safety-only connection'])('keeps bound Block and Ignore on the actual live ID for a %s without requiring contact consent', (mode) => {
        const actor = peerGuest('Sender'), target = peerGuest('Recipient'), other = peerGuest('Other');
        now += 180000; cmd(target, 'nick', ['Renamed']); cmd(other, 'nick', ['Recipient']);
        frames = []; engine.message(target, JSON.stringify({ t: 'say', ch: '#stalemate', text: 'A selected already-delivered safety witness' }));
        const selected = frames.find(frame => frame.recipient === actor && frame.t === 'line'); expect(selected).toBeDefined();
        expect(engine._debug.pm.size).toBe(0);
        if (mode === 'restored safety-only connection') {
            // Restore the strict production safety shape, not a fake C2 grant
            // or a claim to have exercised the separate withdrawal endpoint.
            const snapshot = saved(), record = snapshot.sessions.connections.find(connection => connection.id === actor);
            Object.assign(record, { safetyOnly: true, nick: '', channels: [], cams: [], pmOff: true, entrySource: '', away: '' });
            expect(wake(snapshot).resumed).toEqual([actor, target, other]);
            expect(engine.sessionSnapshot().connections.find(connection => connection.id === actor)).toMatchObject({ safetyOnly: true, nick: '', channels: [], cams: [], pmOff: true });
        }
        const ref = 'a'.repeat(32); // Shape-only safety context, never an accepted contact grant.
        const state = () => engine.sessionSnapshot().connections.find(connection => connection.id === actor);
        const safety = (name, extra = {}) => engine.message(actor, JSON.stringify({ t: 'cmd', name, args: ['Recipient'], ch: `pm:${ref}`, pmPeer: target, pmRef: ref, ...extra }));
        for (const damage of [{ pmPeer: undefined }, { pmRef: undefined }, { pmPeer: undefined, pmRef: undefined }, { pmRef: '' }, { pmPeer: ['invalid'] }]) {
            now += 4000; frames = []; safety('block', damage); safety('ignore', damage);
            expect(state().blocks).toEqual([]); expect(state().ignores).toEqual([]);
            expect(frames.filter(frame => ['pm', 'pm-open', 'pm-request'].includes(frame.t))).toEqual([]);
        }
        now += 4000; frames = []; safety('block'); safety('ignore');
        expect(state().blocks).toEqual(['dev-Recipient']); expect(state().ignores).toEqual(['renamed']);
        expect(state().blocks).not.toContain('dev-Other'); expect(state().ignores).not.toContain('recipient');
        expect(engine._debug.pm.size).toBe(0);
        expect(frames.some(frame => frame.recipient === other && ['pm-closed', 'pm-open', 'pm-request', 'pm'].includes(frame.t))).toBe(false);
        engine.disconnect(target); now += 4000; frames = []; safety('block'); safety('ignore');
        expect(state().blocks).toEqual(['dev-Recipient']); expect(state().ignores).toEqual(['renamed']);
        expect(frames.some(frame => frame.recipient === other && ['pm-closed', 'pm-open', 'pm-request', 'pm'].includes(frame.t))).toBe(false);
        now += 4000; frames = [];
        engine.message(actor, JSON.stringify({ t: 'report', id: selected.id, text: selected.text }));
        expect(frames.some(frame => frame.recipient === actor && frame.t === 'report-status' && frame.submitted)).toBe(true);
        // Both missing binding fields refused above; an actual typed named
        // command is a different, deliberate current-person safety action.
        now += 4000; frames = [];
        engine.message(actor, JSON.stringify({ t: 'say', ch: `pm:${ref}`, text: '/ignore Recipient' }));
        engine.message(actor, JSON.stringify({ t: 'say', ch: `pm:${ref}`, text: '/block Recipient' }));
        expect(state().blocks).toEqual(['dev-Recipient', 'dev-Other']);
        expect(state().ignores).toEqual(['renamed', 'recipient']);
        expect(frames.filter(frame => ['pm', 'pm-open', 'pm-request'].includes(frame.t))).toEqual([]);
        cmd(actor, 'quit');
        expect(engine.sessionSnapshot().connections.some(connection => connection.id === actor)).toBe(false);
    });


    it('blocks a hidden safety-only live endpoint by ID without storing an empty ignore nickname', () => {
        const actor = peerGuest('Sender'), target = peerGuest('Recipient'), other = peerGuest('Other');
        now += 180000; cmd(target, 'nick', ['Renamed']); cmd(other, 'nick', ['Recipient']);
        const snapshot = saved();
        for (const id of [actor, target]) Object.assign(snapshot.sessions.connections.find(connection => connection.id === id),
            { safetyOnly: true, nick: '', channels: [], cams: [], pmOff: true, entrySource: '', away: '' });
        expect(wake(snapshot).resumed).toEqual([actor, target, other]);
        const ref = 'b'.repeat(32); frames = [];
        engine.message(actor, JSON.stringify({ t: 'cmd', name: 'block', args: ['Recipient'], ch: `pm:${ref}`, pmPeer: target, pmRef: ref }));
        let row = engine.sessionSnapshot().connections.find(connection => connection.id === actor);
        expect(row.blocks).toEqual(['dev-Recipient']); expect(row.ignores).toEqual([]);
        expect(row.blocks).not.toContain('dev-Other');
        expect(frames.some(frame => frame.recipient === actor && frame.t === 'notice' && frame.text.includes('this visitor'))).toBe(true);
        expect(frames.filter(frame => ['pm', 'pm-open', 'pm-request'].includes(frame.t))).toEqual([]);
        engine.message(actor, JSON.stringify({ t: 'cmd', name: 'ignore', args: ['Recipient'], ch: `pm:${ref}`, pmPeer: target, pmRef: ref }));
        row = engine.sessionSnapshot().connections.find(connection => connection.id === actor);
        expect(row.ignores).toEqual([]);
        // An empty ignore label would violate the same actual strict reader.
        expect(wake(saved()).resumed).toEqual([actor, target, other]);
        expect(engine.sessionSnapshot().connections.find(connection => connection.id === actor).blocks).toEqual(['dev-Recipient']);
    });

    it('notifies exact surviving endpoints when an accepted pair cannot restore and preserves an unrelated pair', () => {
        for (const condition of ['absent', 'blocked', 'safety-only']) {
            identities = []; sequence = 0; boot();
            const { sender, recipient, other, ref, otherRef } = peerTriangle();
            const snapshot = saved(); let live = identities;
            if (condition === 'absent') live = identities.filter(identity => identity.id !== recipient);
            if (condition === 'blocked') snapshot.sessions.connections.find(connection => connection.id === sender).blocks.push('dev-Recipient');
            if (condition === 'safety-only') Object.assign(snapshot.sessions.connections.find(connection => connection.id === recipient),
                { safetyOnly: true, nick: '', channels: [], cams: [], pmOff: true, entrySource: '', away: '' });
            expect(wake(snapshot, live).resumed).toEqual(live.map(identity => identity.id));
            const closed = frames.filter(frame => frame.t === 'pm-closed');
            expect(closed).toContainEqual({ recipient: sender, t: 'pm-closed', with: condition === 'safety-only' ? 'the other visitor' : 'Recipient', peer: recipient, ref });
            expect(closed.some(frame => frame.recipient === other || frame.ref === otherRef)).toBe(false);
            expect(closed).toHaveLength(condition === 'blocked' ? 2 : 1);
            expect(engine._debug.pm.size).toBe(1);
            frames = []; boundPeerSend(sender, recipient, ref, 'A skipped pair cannot publish after restore', { clientMessageId: '9'.repeat(32) });
            expect(frames.filter(frame => ['pm', 'pm-open', 'pm-request'].includes(frame.t))).toEqual([]);
            expect(frames.filter(frame => frame.t === 'message-result')).toEqual([
                { recipient: sender, t: 'message-result', id: '9'.repeat(32), status: 'rejected' }
            ]);
            now += 4000; frames = []; boundPeerSend(sender, other, otherRef, 'The unrelated accepted pair still works');
            expect(frames.filter(frame => frame.t === 'pm').map(frame => frame.recipient)).toEqual([sender, other]);
        }
    });

    it('closes an explicitly declined open pair and clears a later pending prompt with its own reference', () => {
        const sender = peerGuest('Sender'), recipient = peerGuest('Recipient'); now += 180000;
        const ref = openPeerPair(sender, recipient, 'Sender', 'Recipient'); frames = [];
        cmd(sender, 'decline', ['Recipient']);
        expect(engine._debug.pm.size).toBe(0);
        expect(frames.filter(frame => frame.t === 'pm-closed')).toEqual([
            { recipient, t: 'pm-closed', with: 'Sender', peer: sender, ref },
            { recipient: sender, t: 'pm-closed', with: 'Recipient', peer: recipient, ref }
        ]);
        frames = []; cmd(sender, 'decline', ['Recipient']);
        expect(frames.filter(frame => frame.t === 'pm-closed')).toEqual([]);
        now += 4000; frames = []; cmd(sender, 'query', ['Recipient']);
        const pending = frames.find(frame => frame.recipient === recipient && frame.t === 'pm-request');
        expect(pending.ref).toMatch(/^[a-f0-9]{32}$/); expect(pending.ref).not.toBe(ref); frames = [];
        cmd(recipient, 'decline', ['Sender']);
        expect(engine._debug.pm.size).toBe(0);
        expect(frames.find(frame => frame.recipient === recipient && frame.t === 'pm-request-ended'))
            .toMatchObject({ from: 'Sender', peer: sender, ref: pending.ref });
        expect(frames.filter(frame => frame.t === 'pm-closed' || frame.t === 'pm')).toEqual([]);
    });
});

describe('bound PM Block across later nickname reuse', () => {
    it('keeps the original device blocked without hiding a different live visitor who reclaims its old nickname', () => {
        const observer = peerGuest('Observer'), original = peerGuest('Original'), third = peerGuest('Third');
        now += 180000;
        const ref = openPeerPair(observer, original, 'Observer', 'Original');
        frames = [];
        boundPeerSend(original, observer, ref, 'A confirmed private reply before the deliberate block');
        expect(frames.filter(frame => frame.recipient === observer && frame.t === 'pm'))
            .toEqual([expect.objectContaining({ peer: original, ref, self: false, text: 'A confirmed private reply before the deliberate block' })]);
        now += 4000; frames = [];
        engine.message(observer, JSON.stringify({ t: 'cmd', name: 'block', args: ['Original'], ch: `pm:${ref}`, pmPeer: original, pmRef: ref }));
        const preference = engine.sessionSnapshot().connections.find(connection => connection.id === observer);
        expect(preference.blocks).toEqual(['dev-Original']);
        expect(preference.blocks).not.toContain('dev-Third');
        expect(frames.filter(frame => frame.t === 'pm-closed')).toEqual([
            expect.objectContaining({ recipient: observer, peer: original, ref }),
            expect.objectContaining({ recipient: original, peer: observer, ref })
        ]);
        expect(engine.sessionSnapshot().pm).toEqual([]);
        now += 61000;
        cmd(original, 'nick', ['RenamedOriginal']); cmd(third, 'nick', ['Original']);
        const connections = engine.sessionSnapshot().connections;
        expect(connections.find(connection => connection.id === original).nick).toBe('RenamedOriginal');
        expect(connections.find(connection => connection.id === third).nick).toBe('Original');
        frames = [];
        const blockedText = 'The original visitor is still blocked after a nickname change';
        engine.message(original, JSON.stringify({ t: 'say', ch: '#stalemate', text: blockedText }));
        expect(frames.filter(frame => frame.recipient === third && frame.t === 'line' && frame.text === blockedText))
            .toEqual([expect.objectContaining({ from: 'RenamedOriginal', ch: '#stalemate' })]);
        expect(frames.filter(frame => frame.recipient === observer && frame.t === 'line' && frame.text === blockedText)).toEqual([]);
        // Typed named intent remains deliberate, but the original device's
        // real block must still refuse a fresh PM request after the old pair ended.
        now += 4000; frames = [];
        engine.message(original, JSON.stringify({ t: 'say', ch: '#stalemate', text: '/msg Observer A new private request from the blocked original visitor' }));
        expect(frames.filter(frame => frame.t === 'pm-request' || frame.t === 'pm')).toEqual([]);
        frames = [];
        const replacementText = 'The distinct visitor should remain visible under the reclaimed nickname';
        engine.message(third, JSON.stringify({ t: 'say', ch: '#stalemate', text: replacementText }));
        expect(frames.filter(frame => frame.recipient === third && frame.t === 'line' && frame.text === replacementText))
            .toEqual([expect.objectContaining({ from: 'Original', ch: '#stalemate' })]);
        // Check real publication before this audience assertion: a refused
        // or filtered sender cannot masquerade as the alias-retargeting failure.
        expect(frames.filter(frame => frame.recipient === observer && frame.t === 'line' && frame.text === replacementText))
            .toEqual([expect.objectContaining({ from: 'Original', ch: '#stalemate' })]);
    });
});
