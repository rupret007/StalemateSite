import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const { enqueue } = createRequire(import.meta.url)('../../r/45662413410ed051/video-core.js');

describe('private-room moderation delivery', () => {
    it('moves host actions before signaling backlog without reordering signed actions', () => {
        let queue = [];
        for (const frame of ['offer', 'ice-one', 'chat']) queue = enqueue(queue, { frame, ice: frame.startsWith('ice') }, 10);
        queue = enqueue(queue, { frame: 'camera-off', priority: true }, 10);
        queue = enqueue(queue, { frame: 'lock-room', priority: true }, 10);
        expect(queue.map((e) => e.frame)).toEqual(['camera-off', 'lock-room', 'offer', 'ice-one', 'chat']);
    });
    it('retains host actions and SDP when ICE overflows the bounded queue', () => {
        let queue = enqueue([], { frame: 'camera-off', priority: true }, 3);
        queue = enqueue(queue, { frame: 'offer' }, 3);
        for (let i = 0; i < 50; i++) queue = enqueue(queue, { frame: `ice-${i}`, ice: true }, 3);
        expect(queue).toHaveLength(3);
        expect(queue.slice(0, 2).map((e) => e.frame)).toEqual(['camera-off', 'offer']);
    });
});
