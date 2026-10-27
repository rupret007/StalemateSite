// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createLobby, LOBBY } from '../../hangout-worker/src/lobby-core.mjs';

const DAY = 86400000;
const flagged = { status: 'reviewed', flagged: true, model: 'test-moderation', categories: ['harassment'], scores: { harassment: 0.8 } };
let clock, engine, requests, frames, writes, seq;
function boot(options = {}) {
    clock = 1800000000000; requests = []; frames = new Map(); writes = []; seq = 0;
    engine = createLobby({ now: () => clock, reviewPublicText: (request) => { requests.push(request); },
        send: (id, frame) => { if (!frames.has(id)) frames.set(id, []); frames.get(id).push(frame); },
        persist: (key, value) => writes.push([key, structuredClone(value)]), ...options });
}
function guest(nick, role = 'fan') {
    const id = `c${++seq}`;
    engine.connect({ id, dev: `dev-${nick}`, iph: `ip-${nick}`, role, admin: role === 'band' });
    engine.message(id, JSON.stringify({ t: 'hello', nick, age13: true }));
    return { id, nick };
}
const got = (user) => frames.get(user.id) || [];
const cmd = (user, name, args = [], ch = LOBBY) => engine.message(user.id, JSON.stringify({ t: 'cmd', name, args, ch }));
// Explicit nickname-intent fixtures only; generic/selected/malformed commands stay separate.
const namedCmd = (user, name, args = [], ch = LOBBY) => engine.message(user.id, JSON.stringify({ t: 'cmd', name, args, ch, personNamed: true }));
const say = (user, text, ch = LOBBY) => { clock += 4000; engine.message(user.id, JSON.stringify({ t: 'say', ch, text })); };
const latest = () => requests.at(-1);
beforeEach(() => boot());

describe('public text AI review boundary', () => {
    it('requests only fresh public lines, with opaque id/text only and no activity, PM or restricted-room content', () => {
        const host = guest('Host', 'band'); const pal = guest('Pal');
        say(host, 'public lobby words');
        expect(requests).toEqual([{ id: expect.any(String), text: 'public lobby words' }]);
        cmd(host, 'join', ['#art-open']); cmd(pal, 'join', ['#art-open']);
        say(host, 'public room words', '#art-open');
        expect(requests).toHaveLength(2);
        const expected = [...requests];
        cmd(host, 'mode', ['+i'], '#art-open'); say(host, 'invited members only', '#art-open');
        cmd(host, 'mode', ['-i'], '#art-open'); cmd(host, 'mode', ['+k', 'secret'], '#art-open'); say(host, 'keyed room only', '#art-open');
        cmd(host, 'mode', ['-k'], '#art-open'); cmd(host, 'lock', [], '#art-open'); say(host, 'locked room only', '#art-open');
        cmd(host, 'lock', ['off'], '#art-open');
        engine.message(host.id, JSON.stringify({ t: 'act', ch: '#art-open', kind: 'clear' }));
        cmd(host, 'topic', ['A public topic'], '#art-open');
        namedCmd(host, 'msg', ['Pal', 'private words']); namedCmd(pal, 'accept', ['Host']);
        expect(got(pal).some((frame) => frame.t === 'act' && frame.kind === 'clear')).toBe(true);
        expect(got(pal).some((frame) => frame.t === 'pm' && frame.text === 'private words')).toBe(true);
        guest('Late');
        expect(requests).toEqual(expected);
    });

    it('does not resubmit held approvals and tolerates review failure without suppressing chat', () => {
        const fan = guest('Fan'); const band = guest('Drummer', 'band');
        say(fan, 'you are such a loser');
        const held = engine.adminState().held[0];
        expect(held).toBeTruthy(); expect(requests).toHaveLength(0);
        cmd(band, 'approve', [held.id]);
        expect(requests).toHaveLength(0);
        expect(got(fan).some((frame) => frame.t === 'line' && frame.id === held.id)).toBe(true);
        boot({ reviewPublicText: () => { throw new Error('provider unavailable'); } });
        const sender = guest('Sender'); const receiver = guest('Receiver');
        expect(() => say(sender, 'chat continues')).not.toThrow();
        expect(got(receiver).some((frame) => frame.t === 'line' && frame.text === 'chat continues')).toBe(true);
        expect(engine.adminState().aiReviews).toEqual([]);
    });

    it('keeps AI flags admin-only and review-only; only a band member can resolve them', async () => {
        const fan = guest('Fan'); const pal = guest('Pal'); const band = guest('Drummer', 'band');
        say(fan, 'a human should review this');
        const request = latest();
        frames.set(fan.id, []); frames.set(pal.id, []);
        expect(engine.applyAiReview(request.id, flagged)).toBe(true);
        await Promise.resolve();
        expect(got(fan)).toEqual([]); expect(got(pal)).toEqual([]);
        expect(engine._debug.lines.has(request.id)).toBe(true);
        expect(engine._debug.net.bans).toEqual([]); expect(engine._debug.net.mutes).toEqual({});
        expect(engine.adminState().aiReviews).toEqual([expect.objectContaining({ id: request.id, from: 'Fan', text: request.text, categories: ['harassment'] })]);
        expect(JSON.stringify(engine.snapshot())).not.toContain(request.text);
        expect(writes.filter(([key]) => key === 'ai-reviews').at(-1)[1][0]).not.toHaveProperty('scores');
        cmd(pal, 'aidismiss', [request.id]);
        expect(engine.adminState().aiReviews).toHaveLength(1);
        cmd(band, 'aidismiss', [request.id]);
        expect(engine.adminState().aiReviews).toEqual([]);
        expect(engine.applyAiReview(request.id, flagged)).toBe(false);
    });

    it.each(['delete', 'close', 'restrict', 'expire', 'evict'])('ignores a late result after %s without resurrecting content', (change) => {
        const host = guest('Host', 'band');
        cmd(host, 'join', ['#room-one']); say(host, 'old reviewed words', '#room-one');
        const request = latest();
        if (change === 'delete') cmd(host, 'delete', [request.id]);
        if (change === 'close') { cmd(host, 'close', ['#room-one']); cmd(host, 'join', ['#room-one']); }
        if (change === 'restrict') cmd(host, 'mode', ['+i'], '#room-one');
        if (change === 'expire') { clock += DAY; engine.tick(); }
        if (change === 'evict') for (let i = 0; i < 1001; i += 1) say(host, `new words ${i}`);
        expect(engine.applyAiReview(request.id, flagged)).toBe(false);
        expect(engine.adminState().aiReviews).toEqual([]);
    });

    it('retains at most 100 flags, expires them, and lets humans delete evidence after live line eviction', () => {
        const band = guest('Drummer', 'band');
        for (let i = 0; i < 102; i += 1) { say(band, `queue words ${i}`); engine.applyAiReview(latest().id, flagged); }
        const queue = engine.adminState().aiReviews;
        expect(queue).toHaveLength(100); expect(queue[0].text).toBe('queue words 2');
        for (let i = 0; i < 1001; i += 1) say(band, `later words ${i}`);
        expect(engine._debug.lines.has(queue[0].id)).toBe(false);
        cmd(band, 'delete', [queue[0].id]);
        expect(engine.adminState().aiReviews.some((entry) => entry.id === queue[0].id)).toBe(false);
        clock += DAY; engine.tick();
        expect(engine.adminState().aiReviews).toEqual([]);
        expect(writes.filter(([key]) => key === 'ai-reviews').at(-1)[1]).toEqual([]);
    });

    it('restores only bounded valid evidence and never restores chat or pending provider work', () => {
        const entry = { id: 'm123', from: 'OldGuest', ch: '#old-room', text: 'saved evidence', at: clock, model: 'test-model', categories: ['harassment'] };
        const invalid = [null, { ...entry, id: 'bad' }, { ...entry, categories: ['invented'] }, { ...entry, at: clock + 1 }, { ...entry, at: clock - DAY }];
        engine.restoreAiReviews([entry, ...invalid]);
        expect(engine.adminState().aiReviews).toEqual([entry]);
        expect(engine.applyAiReview(entry.id, flagged)).toBe(false);
        const fan = guest('NewGuest');
        expect(JSON.stringify(got(fan))).not.toContain('saved evidence');
        expect(engine._debug.channels.has('#old-room')).toBe(false);
        expect(() => engine.restoreAiReviews({ nope: true })).not.toThrow();
        expect(engine.adminState().aiReviews).toEqual([]);
    });

    it('rejects malformed model results and exposes provider status only through admin snapshots', async () => {
        const state = { enabled: true, mode: 'review-only', state: 'ready' };
        boot({ aiModerationStatus: () => state });
        const band = guest('Drummer', 'band'); const fan = guest('Fan');
        for (const [index, result] of [null, { ...flagged, categories: ['unknown'] }, { ...flagged, scores: { harassment: NaN } }, { ...flagged, model: '<script>' }, { status: 'unavailable' }].entries()) {
            say(band, `result words ${index}`);
            expect(engine.applyAiReview(latest().id, result)).toBe(false);
        }
        frames.set(fan.id, []); frames.set(band.id, []);
        state.state = 'unavailable'; engine.notifyAiStatus(); await Promise.resolve();
        expect(got(fan)).toEqual([]);
        expect(got(band).at(-1)).toMatchObject({ t: 'admin', state: { aiModeration: { state: 'unavailable' } } });
        expect(engine.adminState().aiReviews).toEqual([]);
    });
});
