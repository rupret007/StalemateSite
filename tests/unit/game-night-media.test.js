// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { allowedMediaDescription } from '../../hangout-worker/src/game-night-media.mjs';

const audio = 'm=audio 9 UDP/TLS/RTP/SAVPF 111';
const video = 'm=video 9 UDP/TLS/RTP/SAVPF 96';
const description = (...rows) => ['v=0', ...rows, ''].join('\r\n');
const silent = { audio: false, video: false };

describe('Game Night media descriptions', () => {
    it('allows listeners and rejects implicit sending before microphone opt-in', () => {
        expect(allowedMediaDescription(description(audio, 'a=recvonly', video, 'a=inactive'), silent)).toBe(true);
        expect(allowedMediaDescription(description('a=recvonly', audio, video), silent)).toBe(true);
        expect(allowedMediaDescription(description(audio), silent)).toBe(false);
    });

    it('checks audio and video individually against approved tracks', () => {
        const offer = description(audio, 'a=sendrecv', video, 'a=sendonly');
        expect(allowedMediaDescription(offer, { audio: true, video: false })).toBe(false);
        expect(allowedMediaDescription(offer, { audio: true, video: true })).toBe(true);
    });

    it('refuses ambiguous directions and unused data channels', () => {
        expect(allowedMediaDescription(description(audio, 'a=sendonly', 'a=recvonly'), silent)).toBe(false);
        expect(allowedMediaDescription(description('m=video 0 UDP/TLS/RTP/SAVPF 96', 'a=bundle-only'), silent)).toBe(false);
        expect(allowedMediaDescription(description('m=application 9 UDP/DTLS/SCTP webrtc-datachannel'), silent)).toBe(false);
    });
});
