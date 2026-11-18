const fs = require('node:fs');
const path = require('node:path');

// Renderer controls use the production DOM, core and room module with native
// canvas pixels. Private admission and physical input remain covered separately.
async function openCanvasControls(page) {
    const root = path.resolve(__dirname, '../../..');
    const html = fs.readFileSync(path.join(root, 'r/45662413410ed051/lobby/index.html'), 'utf8')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    await page.route('**/canvas-controls', route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto('/canvas-controls');
    for (const file of ['sync-core.js', 'video-core.js', 'youtube-player.js', 'bob-ross.js', 'lobby/lobby-room.js']) {
        await page.addScriptTag({ url: '/r/45662413410ed051/' + file });
    }
    await page.evaluate(() => {
        const channel = { name: '#canvas-control', kind: 'art', names: [{ nick: 'Painter', id: 'self' }] };
        const app = { me: 'Painter', active: channel.name, band: false, chans: new Map([[channel.name, channel]]) };
        const sent = [];
        const canvas = document.querySelector('[data-act-canvas]');
        for (let parent = canvas.parentElement; parent; parent = parent.parentElement) {
            parent.hidden = false;
            if (parent instanceof HTMLDetailsElement) parent.open = true;
        }
        const room = window.LobbyRoom.attach({
            app, send: frame => { sent.push(frame); return true; },
            $: selector => document.querySelector(selector), turnUrl: ''
        });
        room.onJoin(channel, { strokes: [] });
        const mouse = (type, x, y) => {
            const box = canvas.getBoundingClientRect();
            // PointerEvent retains fractional input coordinates. Legacy
            // MouseEvent rounds them before the production listener sees them.
            canvas.dispatchEvent(new PointerEvent(type, {
                clientX: box.left + x * box.width, clientY: box.top + y * box.height,
                button: 0, pointerType: 'mouse', cancelable: true
            }));
        };
        const pixels = async () => {
            const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)),
                value => value.toString(16).padStart(2, '0')).join('');
        };
        const snapshot = () => {
            const strokes = structuredClone(window.__lobbyRoom.state.room.strokes);
            room.onJoin(channel, { strokes });
        };
        const incoming = (stroke) => room.onAct({ ch: channel.name, from: 'remote', kind: 'stroke', stroke });
        window.canvasControls = { app, channel, room, canvas, mouse, pixels, snapshot, incoming, sent };
    });
}

module.exports = { openCanvasControls };
