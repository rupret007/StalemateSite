// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL('../../r/45662413410ed051/' + name, import.meta.url), 'utf8');
const windows = [];
afterEach(() => { for (const dom of windows.splice(0)) dom.window.close(); });
async function fixture({ startsPlaying = true, sharedPlaying = true } = {}) {
    const dom = new JSDOM(read('lobby/index.html'), { url: 'http://127.0.0.1:4527/', runScripts: 'outside-only' }); windows.push(dom);
    const w = dom.window, timers = new Map(), intervals = [], sent = []; let at = 1000, serial = 0, playing = false, pos = 0, callbacks;
    w.Date.now = () => at;
    w.setTimeout = (fn, delay) => { timers.set(++serial, { fn, delay }); return serial; }; w.clearTimeout = id => timers.delete(id);
    w.setInterval = fn => { intervals.push(fn); return intervals.length; }; w.clearInterval = () => {};
    w.HangoutVideo = { isPhoneDevice: () => false };
    w.BobRoss = { EPISODES: [] };
    w.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} });
    const player = { getCurrentTime: () => pos, getPlayerState: () => playing ? 1 : 2,
        seekTo(value) { pos = value; }, playVideo() { if (startsPlaying) { playing = true; callbacks.onStateChange({ target: player, data: 1 }); } },
        pauseVideo() { playing = false; callbacks.onStateChange({ target: player, data: 2 }); } };
    w.HangoutYouTube = { create: options => { callbacks = options; return { select: async () => player, cancel() {} }; } };
    w.eval(read('sync-core.js')); w.eval(read('lobby/lobby-room.js'));
    const app = { me: 'Host', active: '#watch-controls', band: false, chans: new Map() };
    const room = w.LobbyRoom.attach({ app, send: message => { sent.push(structuredClone(message)); return true; }, $: selector => w.document.querySelector(selector), turnUrl: '' });
    const join = () => {
        const channel = { name: app.active, kind: 'watch', names: [{ nick: 'Host', id: 'host', prefix: '@' }] }; app.chans.set(channel.name, channel);
        room.onJoin(channel, { video: { source: { kind: 'yt', id: 'BtnyqIHTDMM' }, playing: sharedPlaying, pos: 0, t: at } });
    };
    join(); for (let i = 0; i < 6; i++) await Promise.resolve();
    const flush = () => { for (const [id, timer] of [...timers]) if (timer.delay === 100) { timers.delete(id); timer.fn(); } };
    sent.length = 0;
    return { w, room, app, player, callbacks, sent, timers, intervals, join, flush, state: w.__lobbyRoom.state,
        setTime: value => at = value, play: () => { playing = true; callbacks.onStateChange({ target: player, data: 1 }); } };
}

describe('host YouTube control intent and initialization echoes', () => {
    it('suppresses its matching programmatic PLAYING echo during synchronization', async () => {
        const f = await fixture(); f.flush(); expect(f.sent).toEqual([]); expect(f.w.__lobbyRoom.player.seenPlaying).toBe(true);
    });
    it('publishes a host scrub of an initially paused source without requiring prior playback', async () => {
        const f = await fixture({ sharedPlaying: false }); expect(f.w.__lobbyRoom.player.seenPlaying).toBe(false);
        f.player.seekTo(42); f.setTime(4000); for (const tick of f.intervals) tick();
        expect(f.sent).toHaveLength(1); expect(f.sent[0]).toMatchObject({ kind: 'video', playing: false, pos: 42 });
        expect(f.w.__lobbyRoom.player.seenPlaying).toBe(false);
    });
    it('publishes host pause and play within the initial 900ms synchronization window', async () => {
        const f = await fixture(); expect(f.w.__lobbyRoom.player.applying).toBeGreaterThan(f.w.Date.now());
        f.player.pauseVideo(); f.flush(); expect(f.sent).toHaveLength(1); expect(f.sent[0]).toMatchObject({ kind: 'video', playing: false });
        f.state.room.video.playing = false; f.sent.length = 0; f.play(); f.flush();
        expect(f.sent).toHaveLength(1); expect(f.sent[0]).toMatchObject({ kind: 'video', playing: true });
    });
    it('does not turn an initial paused player into shared pause before a delayed autoplay denial', async () => {
        const f = await fixture({ startsPlaying: false }); f.player.pauseVideo(); f.flush(); f.setTime(4000);
        for (const tick of f.intervals) tick(); expect(f.sent).toEqual([]);
        f.callbacks.onAutoplayBlocked({ target: f.player }); expect(f.w.__lobbyRoom.player.autoplayBlocked).toBe(true);
        expect(f.w.document.querySelector('[data-act-tap]').hidden).toBe(false);
    });
    it('ignores stale blocked callbacks after actual playback and keeps the host pause publishable', async () => {
        const f = await fixture(); f.player.pauseVideo(); f.callbacks.onAutoplayBlocked({ target: f.player }); f.flush();
        expect(f.w.__lobbyRoom.player.autoplayBlocked).toBe(false); expect(f.sent).toHaveLength(1); expect(f.sent[0].playing).toBe(false);
    });
    it('does not treat a stale PLAYING callback as current playback evidence', async () => {
        const f = await fixture({ startsPlaying: false }); f.callbacks.onAutoplayBlocked({ target: f.player });
        f.callbacks.onStateChange({ target: f.player, data: 1 }); f.flush();
        expect(f.w.__lobbyRoom.player.seenPlaying).toBe(false); expect(f.w.__lobbyRoom.player.autoplayBlocked).toBe(true); expect(f.sent).toEqual([]);
    });
    it('rechecks current host authority before publishing a delayed control', async () => {
        const f = await fixture(); f.player.pauseVideo(); f.app.chans.get(f.app.active).names[0].prefix = ''; f.flush(); expect(f.sent).toEqual([]);
    });
    it('does not let a queued old playback event publish into a rejoined room lifetime', async () => {
        const f = await fixture(); f.setTime(2500); f.player.pauseVideo(); const timer = [...f.timers.values()].find(t => t.delay === 100)?.fn;
        expect(timer).toBeTypeOf('function'); f.join(); for (let i = 0; i < 6; i++) await Promise.resolve(); f.sent.length = 0; f.setTime(5000);
        timer(); expect(f.sent).toEqual([]);
    });
});
