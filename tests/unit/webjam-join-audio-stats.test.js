// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { adaptJitterBufferTarget, latencyMs } from '../../join/audio.js';
import { WebJoinSession } from '../../join/session.js';

const statsFor = (selected, reverse = false) => {
    const pairs = [
        ['fast', { type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.04 }],
        ['slow', { type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 1.2 }]
    ];
    return new Map([
        ['transport', { type: 'transport', selectedCandidatePairId: selected, bytesSent: 5, bytesReceived: 5 }],
        ...(reverse ? pairs.reverse() : pairs),
        ['audio', { type: 'inbound-rtp', kind: 'audio', packetsReceived: 100, packetsLost: 0,
            jitter: 0, jitterBufferDelay: 2, jitterBufferEmittedCount: 100 }]
    ]);
};

describe('packaged Web Join audio diagnostics', () => {
    it.each([
        ['fast', false, 50, 20], ['fast', true, 50, 20],
        ['slow', false, 630, 30], ['slow', true, 630, 30]
    ])('uses selected %s path with reversed order=%s', (selected, reverse, delay, target) => {
        const stats = statsFor(selected, reverse);
        stats.get(selected).nominated = false;
        expect(latencyMs(stats, 0.01)).toBe(delay);
        expect(adaptJitterBufferTarget(stats, { targetMs: 20, lastChangeAt: 0 }).targetMs).toBe(target);
    });

    it('keeps unknown and ambiguous paths unknown rather than using a retired pair', () => {
        const stats = statsFor('missing');
        expect(latencyMs(stats, 0.01)).toBeNull();
        stats.get('transport').selectedCandidatePairId = 'fast';
        stats.set('second', { type: 'transport', selectedCandidatePairId: 'slow' });
        expect(latencyMs(stats, 0.01)).toBeNull();
        expect(adaptJitterBufferTarget(stats, { targetMs: 20, lastChangeAt: 0 }).rttMs).toBeUndefined();
    });

    it('clears an old estimate through the shipped session and recovers on a new path', async () => {
        const stats = statsFor('fast'), delays = [], errors = [];
        const track = { enabled: true, stop() {} };
        const session = new WebJoinSession({ origin: 'https://relay.example', invite: {},
            stream: { getAudioTracks: () => [track], getTracks: () => [track] },
            audioContext: { baseLatency: 0.01 }, onLatency: value => delays.push(value),
            onError: error => errors.push(error) });
        session.pc = { connectionState: 'connected', getStats: async () => stats, close() {} };
        session.authorized = true;
        session._inboundReceiver = { jitterBufferTarget: 20 };
        try {
            await session.updateStats();
            expect(session._inboundReceiver.jitterBufferTarget).toBe(20);
            stats.get('transport').selectedCandidatePairId = 'missing';
            await session.updateStats();
            stats.get('transport').selectedCandidatePairId = 'slow';
            await session.updateStats();
            expect(delays).toEqual([50, null, 630]);
            expect(errors).toEqual([]);
            expect(session.previousBytes).toBe(10);
        } finally {
            session.close();
        }
    });
});
