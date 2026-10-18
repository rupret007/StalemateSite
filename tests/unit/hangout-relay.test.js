// @vitest-environment node
import { describe, expect, it, afterEach } from 'vitest';
import WebSocket from 'ws';
import { startRelay } from '../../scripts/hangout-relay-dev.mjs';

const KEY = 'local-preview-key-0001';
const ROOM = 'a'.repeat(64);

function connectRelay(relay, roomId = ROOM) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${relay.port}/room?room=${roomId}&preview=${KEY}`, {
            headers: { origin: 'http://127.0.0.1:4320' }
        });
        ws.on('message', (data) => {
            try {
                const frame = JSON.parse(String(data));
                if (frame.welcome) {
                    ws.off('error', reject);
                    resolve({ ws, welcome: frame });
                }
            } catch (error) { /* ignore */ }
        });
        ws.on('error', reject);
    });
}

function waitJson(ws, filter) {
    return new Promise((resolve, reject) => {
        const onMessage = (data) => {
            let frame;
            try { frame = JSON.parse(String(data)); } catch (error) { return; }
            if (filter(frame)) {
                ws.off('message', onMessage);
                resolve(frame);
            }
        };
        ws.on('message', onMessage);
        ws.on('close', () => reject(new Error('closed before frame')));
    });
}

describe('hangout dev relay', () => {
    let relay;
    afterEach(async () => { if (relay) await relay.close(); relay = null; });

    it('broadcasts the departing peer id when a socket closes', async () => {
        relay = await startRelay({ previewKey: KEY, origins: 'http://127.0.0.1:4320' });
        const a = await connectRelay(relay);
        const b = await connectRelay(relay);
        const leftPromise = waitJson(a.ws, (f) => f.left === b.welcome.id && f.peers === 1);
        b.ws.terminate();
        const left = await leftPromise;
        expect(left.peers).toBe(1);
        expect(left.left).toBe(b.welcome.id);
        a.ws.close();
    });
});
