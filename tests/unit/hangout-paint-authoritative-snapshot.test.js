// @vitest-environment node
// Semantic drawing-record checks, not a substitute for native canvas pixels.
// Observe only public room joins/acts and primitive canvas drawing commands.
import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

import { productFile } from '../support/product-room.cjs';
const read = name => readFileSync(productFile(name), 'utf8');
const html = read('lobby/index.html');
const core = read('sync-core.js');
const client = read('lobby/lobby-room.js');
const youtube = read('youtube-player.js');
const windows = [];
afterEach(() => { for (const dom of windows.splice(0)) dom.window.close(); });

function fixture() {
    const dom = new JSDOM(html, { url: 'http://127.0.0.1:4320/', runScripts: 'outside-only' });
    windows.push(dom);
    const { window } = dom;
    const contexts = new WeakMap();
    let timerId = 0;
    window.setTimeout = () => ++timerId;
    window.clearTimeout = () => {};
    const reset = canvas => {
        const record = contexts.get(canvas);
        if (!record) return;
        record.ink = []; record.path = [];
        Object.assign(record.context, { strokeStyle: '#000000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter' });
    };
    const prototype = window.HTMLCanvasElement.prototype;
    for (const dimension of ['width', 'height']) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, dimension);
        Object.defineProperty(prototype, dimension, {
            ...descriptor,
            set(value) { descriptor.set.call(this, value); reset(this); },
        });
    }
    prototype.getContext = function () {
        if (!contexts.has(this)) {
            const record = { ink: [], path: [], context: null };
            record.context = {
                strokeStyle: '#000000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
                clearRect() { record.ink = []; },
                beginPath() { record.path = []; },
                moveTo(x, y) { record.path = [[x, y]]; },
                lineTo(x, y) { record.path.push([x, y]); },
                stroke() {
                    record.ink.push({ color: this.strokeStyle, width: this.lineWidth,
                        cap: this.lineCap, join: this.lineJoin, points: structuredClone(record.path) });
                },
                drawImage(source) {
                    const painted = contexts.get(source);
                    if (painted) record.ink.push(...structuredClone(painted.ink));
                },
            };
            contexts.set(this, record);
        }
        return contexts.get(this).context;
    };
    window.HangoutVideo = { isPhoneDevice: () => false };
    window.eval(youtube);
    window.HangoutYouTube.create = () => ({ cancel() {} });
    window.eval(core); window.eval(client);
    const channel = { name: '#snapshot-control', kind: 'art', keepRef: 'a'.repeat(32),
        names: [{ nick: 'Painter', id: 'self' }, { nick: 'Peer', id: 'peer' }] };
    const app = { me: 'Painter', active: channel.name, band: false, chans: new Map([[channel.name, channel]]) };
    const room = window.LobbyRoom.attach({ app, send: () => true,
        $: selector => window.document.querySelector(selector), turnUrl: '' });
    const canvas = window.document.querySelector('[data-act-canvas]');
    const snapshot = (strokes, nextChannel = channel) => {
        app.chans.set(nextChannel.name, nextChannel);
        room.onJoin(nextChannel, { strokes: structuredClone(strokes) });
    };
    const painted = () => structuredClone(contexts.get(canvas)?.ink || []);
    const expected = strokes => strokes.map(stroke => ({
        color: stroke.color, width: stroke.size * (canvas.width / 1200), cap: 'round', join: 'round',
        points: stroke.pts.map(([x, y]) => [x * canvas.width, y * canvas.height]),
    }));
    return { room, channel, snapshot, painted, expected };
}

const strokes = () => [
    { id: 'retained-prefix', color: '#c98a24', size: 8, pts: [[0.1, 0.1], [0.3, 0.3]] },
    { id: 'current-tail', color: '#009ee8', size: 8, pts: [[0.4, 0.4], [0.5, 0.5]] },
];

describe('authoritative Paint snapshot replaces retained drawing', () => {
    it.each(['coordinates', 'color', 'width'])('uses replacement %s even with unchanged stroke IDs and point counts', field => {
        const f = fixture(), initial = strokes();
        f.snapshot(initial);
        expect(f.painted()).toEqual(f.expected(initial));
        const replacement = strokes();
        if (field === 'coordinates') replacement[0].pts = [[0.6, 0.6], [0.8, 0.8]];
        if (field === 'color') replacement[0].color = '#ed2765';
        if (field === 'width') replacement[0].size = 16;
        f.snapshot(replacement);
        expect(f.painted()).toEqual(f.expected(replacement));
    });

    it('does not display the old room generation after leaving and rejoining the same channel', () => {
        const f = fixture(), initial = strokes();
        f.snapshot(initial);
        expect(f.painted()).toEqual(f.expected(initial));
        f.room.onLeave();
        const replacement = strokes(); replacement[0].color = '#ed2765';
        f.snapshot(replacement, { ...f.channel, keepRef: 'b'.repeat(32) });
        expect(f.painted()).toEqual(f.expected(replacement));
    });

    it('preserves an identical authoritative snapshot', () => {
        const f = fixture(), initial = strokes();
        f.snapshot(initial); f.snapshot(strokes());
        expect(f.painted()).toEqual(f.expected(initial));
    });

    it('preserves the unchanged prefix while an incoming tail gains points', () => {
        const f = fixture(), initial = strokes();
        f.snapshot(initial);
        const points = [[0.6, 0.6], [0.7, 0.7]];
        f.room.onAct({ ch: f.channel.name, kind: 'stroke', from: 'peer',
            stroke: { ...initial[1], pts: points } });
        const updated = strokes(); updated[1].pts.push(...points);
        expect(f.painted()).toEqual(f.expected(updated));
    });
});
