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
        expect(snapshot.sessions.pendingPm).toEqual([{ key: [sender, recipient].sort().join('|'), from: 'dev-Sender',
            fromId: sender, toId: recipient, at: now, hadFirst: true }]);
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
        frames = [];
        engine.disconnect(departing);
        expect(engine._debug.pm.size).toBe(0);
        expect(frames.filter(frame => frame.t === 'pm-closed')).toEqual([
            { recipient: survivor, t: 'pm-closed', with: departedNick }
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
        expect(frames.filter(frame => frame.t === 'pm-request')).toEqual([
            { recipient, t: 'pm-request', from: 'Sender', band: false }
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
                { recipient: 'Recipient', t: 'pm-closed', with: 'Sender' }
            ]);
            if (rejected) {
                expect(lobby.snapshot().lock).toBe('readonly');
                expect(sent.some(frame => frame.recipient === 'Recipient' && frame.t === 'notice' && /Storage is unavailable/.test(frame.text))).toBe(true);
            }
        }
    });
});
