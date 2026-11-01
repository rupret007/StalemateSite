// @vitest-environment node
// Actual lobby engine. Device references below are explicit test identities;
// these checks do not qualify a hosted identity provider or native media path.
import { describe, expect, it } from 'vitest';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';

const ROOM = '#art-blocking', START = 1800000000000;
async function fixture({ fenced = false } = {}) {
    let at = START;
    const frames = [], identities = [], controls = { deny: false }, observedRooms = new Map();
    const engine = createLobby({ now: () => at, limits: { defaultSlow: 0, pmMinLobbyMs: 0 },
        send: (recipient, frame) => {
            if (['join', 'chan'].includes(frame.t)) observedRooms.set(`${recipient}:${frame.ch.name}`, structuredClone(frame.ch));
            frames.push({ recipient, ...structuredClone(frame) });
        },
        ...(fenced ? { effectCommit: { prepare: operation => ({ operation }), commit: async (_context, _effects, { costsOnly }) =>
            costsOnly || !controls.deny ? { ok: true } : { ok: false, reason: 'session-denied' } } } : {}) });
    const message = (id, frame) => engine.message(id, JSON.stringify(frame));
    const cmd = (id, name, args = [], ch = ROOM) => message(id, { t: 'cmd', name, args, ch });
    const selectedControl = (id, name, targetId, ch = ROOM) => {
        expect(['block', 'unblock']).toContain(name);
        const room = observedRooms.get(`${id}:${ch}`), target = room?.names.find(person => person.id === targetId);
        expect(room?.keepRef).toMatch(/^[a-f0-9]{32}$/); expect(target?.id).toBe(targetId);
        return message(id, { t: 'cmd', name, args: [target.nick], ch,
            personContext: 1, personPeer: target.id, roomInstance: room.keepRef });
    };
    const connect = async (id, nick, dev = `device-${id}`) => {
        const identity = { id, dev, iph: `ip-${id}`, role: 'fan', account: '', admin: false }; identities.push(identity);
        expect(await engine.connect(identity)).toMatchObject({ ok: true });
        await message(id, { t: 'hello', nick, age13: true });
        await cmd(id, 'join', [ROOM], '#stalemate');
        await message(id, { t: 'cam', ch: ROOM, on: true, adult18: true });
    };
    await connect('alpha', 'Alpha'); await connect('bravo', 'Bravo'); await connect('witness', 'Witness');
    const reset = () => { frames.length = 0; at += 10000; };
    const rtc = (from, to, body = { sdp: { type: 'offer', sdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n' } }) => message(from, { t: 'act', ch: ROOM, kind: 'rtc', to, ...body });
    const view = (id, room = ROOM) => frames.filter(frame => frame.recipient === id && frame.t === 'chan' && frame.ch.name === room).at(-1)?.ch;
    const policy = (id, room = ROOM) => frames.filter(frame => frame.recipient === id && frame.t === 'media-policy' && frame.ch === room).at(-1)?.changes;
    reset(); return { engine, frames, controls, identities, message, cmd, selectedControl, connect, rtc, view, policy, reset, advance: ms => { at += ms; } };
}

describe('personal Block covers public-room media', () => {
    it.each([
        ['offer', { sdp: { type: 'offer', sdp: 'v=0' } }],
        ['answer', { sdp: { type: 'answer', sdp: 'v=0' } }],
        ['ICE', { ice: { candidate: 'candidate:synthetic' } }]
    ])('refuses %s in both directions without affecting another participant', async (_label, body) => {
        const f = await fixture(); await f.selectedControl('alpha', 'block', 'bravo'); f.reset();
        await f.rtc('alpha', 'bravo', body); await f.rtc('bravo', 'alpha', body);
        expect(f.frames.filter(frame => frame.kind === 'rtc')).toEqual([]);
        await f.rtc('alpha', 'witness', body); await f.rtc('bravo', 'witness', body);
        expect(f.frames.filter(frame => frame.kind === 'rtc').map(frame => [frame.from, frame.recipient])).toEqual([['alpha', 'witness'], ['bravo', 'witness']]);
    });

    it('publishes recipient-specific connection IDs for every parallel connection of the blocked device', async () => {
        const f = await fixture(); await f.connect('parallel', 'OtherBravo', 'device-bravo'); f.reset();
        await f.selectedControl('alpha', 'block', 'bravo');
        expect(f.policy('alpha')).toEqual([{ id: 'bravo', blocked: true }, { id: 'parallel', blocked: true }]);
        expect(f.policy('bravo')).toEqual([{ id: 'alpha', blocked: true }]);
        expect(f.policy('parallel')).toEqual([{ id: 'alpha', blocked: true }]);
        expect(f.policy('witness')).toBeUndefined();
        expect(f.frames.some(frame => frame.t === 'chan')).toBe(false);
        expect(JSON.stringify(f.frames.filter(frame => frame.t === 'media-policy'))).not.toContain('device-');
        f.reset(); await f.rtc('parallel', 'alpha'); await f.rtc('alpha', 'parallel');
        expect(f.frames.filter(frame => frame.kind === 'rtc')).toEqual([]);
    });

    it('follows the same device through nickname, entry badge, and later parallel joins', async () => {
        const f = await fixture(); await f.selectedControl('alpha', 'block', 'bravo'); f.reset();
        f.advance(61000);
        await f.cmd('bravo', 'nick', ['ChangedBravo']);
        expect(f.engine._debug.conns.get('bravo').nick).toBe('ChangedBravo');
        await f.message('bravo', { t: 'entry-source', source: 'rad-dad' });
        await f.rtc('bravo', 'alpha'); expect(f.frames.filter(frame => frame.kind === 'rtc')).toEqual([]);
        await f.connect('later', 'FreshBravo', 'device-bravo');
        const admission = f.frames.find(frame => frame.recipient === 'later' && frame.t === 'join' && frame.ch.name === ROOM);
        expect(admission.ch.mediaBlocked).toEqual(['alpha']);
        expect(f.view('alpha').mediaBlocked).toEqual(['bravo', 'later']);
        f.reset(); await f.rtc('later', 'alpha'); expect(f.frames.filter(frame => frame.kind === 'rtc')).toEqual([]);
    });

    it('refreshes another shared room containing only a parallel connection of the named target device', async () => {
        const f = await fixture(); await f.connect('parallel', 'OtherBravo', 'device-bravo');
        f.advance(11 * 60000); await f.cmd('alpha', 'join', ['#art-other']);
        await f.cmd('parallel', 'join', ['#art-other']);
        expect(f.engine._debug.channels.get('#art-other').members.has('bravo')).toBe(false); f.reset();
        await f.selectedControl('alpha', 'block', 'bravo');
        expect(f.policy('alpha', '#art-other')).toEqual([{ id: 'parallel', blocked: true }]);
        expect(f.policy('parallel', '#art-other')).toEqual([{ id: 'alpha', blocked: true }]);
        await f.selectedControl('alpha', 'unblock', 'bravo');
        expect(f.policy('alpha', '#art-other')).toEqual([{ id: 'parallel', blocked: false }]);
        expect(f.policy('parallel', '#art-other')).toEqual([{ id: 'alpha', blocked: false }]);
    });

    it('unblocks only the caller: the other visitor’s block remains authoritative', async () => {
        const f = await fixture(); await f.selectedControl('alpha', 'block', 'bravo'); await f.selectedControl('bravo', 'block', 'alpha'); f.reset();
        await f.selectedControl('alpha', 'unblock', 'bravo');
        expect(f.policy('alpha')).toEqual([{ id: 'bravo', blocked: true }]); expect(f.policy('bravo')).toEqual([{ id: 'alpha', blocked: true }]);
        f.reset(); await f.rtc('bravo', 'alpha'); expect(f.frames.filter(frame => frame.kind === 'rtc')).toEqual([]);
        await f.selectedControl('bravo', 'unblock', 'alpha');
        expect(f.policy('alpha')).toEqual([{ id: 'bravo', blocked: false }]); expect(f.policy('bravo')).toEqual([{ id: 'alpha', blocked: false }]);
        f.reset(); await f.rtc('alpha', 'bravo'); expect(f.frames.filter(frame => frame.kind === 'rtc')).toHaveLength(1);
        expect(f.engine._debug.pm.size).toBe(0);
    });

    it('does not broadcast media policy again for duplicate Block or absent Unblock preferences', async () => {
        const f = await fixture(); await f.selectedControl('alpha', 'block', 'bravo'); f.reset();
        await f.selectedControl('alpha', 'block', 'bravo');
        expect(f.frames.some(frame => frame.t === 'media-policy' || frame.t === 'chan')).toBe(false);
        expect(f.engine._debug.conns.get('alpha').blocks.has('device-bravo')).toBe(true);
        f.reset(); await f.selectedControl('alpha', 'unblock', 'bravo'); f.reset();
        await f.selectedControl('alpha', 'unblock', 'bravo');
        expect(f.frames.some(frame => frame.t === 'media-policy' || frame.t === 'chan')).toBe(false);
        expect(f.engine._debug.conns.get('alpha').blocks.has('device-bravo')).toBe(false);
    });

    it('reveals no policy or membership for a target room the blocker has not joined', async () => {
        const f = await fixture(); await f.cmd('bravo', 'join', ['#art-hidden', 'privatekey']);
        await f.cmd('bravo', 'mode', ['+i'], '#art-hidden');
        expect(f.engine._debug.channels.get('#art-hidden').members.has('alpha')).toBe(false); f.reset();
        await f.selectedControl('alpha', 'block', 'bravo');
        const policies = f.frames.filter(frame => frame.t === 'media-policy');
        expect(policies).toHaveLength(2);
        expect(policies.every(frame => frame.ch === ROOM && ['alpha', 'bravo'].includes(frame.recipient))).toBe(true);
        expect(f.policy('witness')).toBeUndefined();
        expect(JSON.stringify(f.frames)).not.toContain('#art-hidden');
    });

    it('retains the media restriction after a same-socket server wake without storing media bodies', async () => {
        const f = await fixture(); await f.selectedControl('alpha', 'block', 'bravo');
        const saved = { net: f.engine.snapshot(), rooms: f.engine.roomSnapshot(), abuse: f.engine.abuseSnapshot(), sessions: f.engine.sessionSnapshot() };
        const frames = [], woke = createLobby({ now: () => START + 100000, limits: { defaultSlow: 0 }, send: (recipient, frame) => frames.push({ recipient, ...frame }) });
        woke.restore(saved.net); await woke.restoreRooms(saved.rooms); woke.restoreAbuse(saved.abuse);
        expect(woke.restoreSessions(saved.sessions, f.identities).resumed).toEqual(['alpha', 'bravo', 'witness']);
        await woke.message('bravo', JSON.stringify({ t: 'act', ch: ROOM, kind: 'rtc', to: 'alpha', ice: { candidate: 'after-wake' } }));
        expect(frames.filter(frame => frame.kind === 'rtc')).toEqual([]);
        expect(JSON.stringify(saved.sessions)).not.toMatch(/candidate:|m=video|mediaBlocked/);
    });

    it('withholds changed media policy when the configured durable effect fence refuses Block', async () => {
        const f = await fixture({ fenced: true }); f.controls.deny = true;
        expect(await f.selectedControl('alpha', 'block', 'bravo')).toMatchObject({ ok: false });
        expect(f.engine._debug.conns.get('alpha').blocks.size).toBe(0);
        expect(f.frames.some(frame => frame.t === 'chan' || frame.t === 'media-policy' || frame.t === 'pm-closed' || frame.text?.startsWith('Blocked '))).toBe(false);
        f.controls.deny = false; f.reset(); await f.rtc('alpha', 'bravo');
        expect(f.frames.filter(frame => frame.kind === 'rtc')).toHaveLength(1);
    });
});
