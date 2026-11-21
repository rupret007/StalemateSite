// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { allowedMediaDescription, createGameNightMedia } from '../../hangout-worker/src/game-night-media.mjs';

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

function relayFixture(submitReport) {
    const ref = '7'.repeat(32), room = '#game-relay', dev = 'A'.repeat(22);
    let clock = 10_000, permits = true, blocked = false, active = true;
    const socket = (actor, joined) => ({
        readyState: 1, frames: [], attachment: { kind: 'game-night-media', betaSid: actor, betaInviteVersion: 1, actor, ref, room, joined, tracks: silent },
        deserializeAttachment() { return this.attachment; },
        serializeAttachment(attachment) { this.attachment = attachment; },
        send(frame) { this.frames.push(JSON.parse(frame)); },
        close() { this.readyState = 3; }
    });
    const first = socket('first', true), second = socket('second', true), waiting = socket('waiting', false);
    const getWebSockets = () => [first, second, waiting];
    const iceServers = [{ urls: ['turn:fixture.invalid'], username: 'fixture', credential: 'fixture-only' }];
    const mintRelay = vi.fn(() => Promise.resolve({ iceServers, expiresAt: clock + 600_000 }));
    const service = createGameNightMedia({
        state: { getWebSockets }, current: scope => ({ betaSid: scope.actor, betaInviteVersion: 1, dev, nick: scope.actor,
            canPlay: true, canCall: peer => !blocked && peer !== scope.actor }),
        active: () => active, approve: () => permits, charge: () => true, allowed: () => true,
        mintRelay, serialize: operation => operation(), now: () => clock, submitReport
    });
    const receive = (socket, action, fields) => service.receive(socket, JSON.stringify({ version: 1, action, ...fields }));
    return { ref, dev, first, second, waiting, iceServers, mintRelay, receive, reconcile: service.reconcile, advance: ms => { clock += ms; },
        revoke: () => { permits = false; }, block: () => { blocked = true; }, expire: () => { active = false; } };
}

describe('Game Night relay admission', () => {
    it('requires a joined call with an eligible peer before touching the provider', async () => {
        const f = relayFixture();
        await f.receive(f.waiting, 'relay');
        expect(f.waiting.frames).toContainEqual({ t: 'media-error', reason: 'call-required' });
        f.block();
        await f.receive(f.first, 'relay');
        expect(f.first.frames).toContainEqual({ t: 'media-error', reason: 'relay-unavailable' });
        expect(f.mintRelay).not.toHaveBeenCalled();
    });

    it('delivers only to the requesting socket and paces renewal', async () => {
        const f = relayFixture();
        const relay = await f.receive(f.first, 'relay');
        expect(f.mintRelay).not.toHaveBeenCalled();
        expect(await f.receive(f.first, 'relay')).toBeUndefined();
        await relay();
        expect(f.mintRelay).toHaveBeenCalledExactlyOnceWith(f.ref, f.dev);
        expect(f.first.frames).toContainEqual({ t: 'media-relay', version: 1, iceServers: f.iceServers, refreshInMs: 540_000 });
        expect(f.second.frames).toHaveLength(0);
        expect(f.first.attachment).not.toHaveProperty('iceServers');
        f.advance(539_999);
        expect(await f.receive(f.first, 'relay')).toBeUndefined();
        expect(f.mintRelay).toHaveBeenCalledTimes(1);
        f.advance(1);
        await (await f.receive(f.first, 'relay'))();
        expect(f.mintRelay).toHaveBeenCalledTimes(2);
    });

    it.each(['leave', 'block', 'revoke', 'expire'])('withholds a credential when %s takes effect during minting', async ending => {
        const f = relayFixture();
        let finish;
        f.mintRelay.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        const job = (await f.receive(f.first, 'relay'))();
        if (ending === 'leave') await f.receive(f.first, 'leave');
        else f[ending]();
        finish({ iceServers: f.iceServers, expiresAt: 610_000 });
        await job;
        for (const socket of [f.first, f.second]) expect(socket.frames.every(frame => frame.t !== 'media-relay')).toBe(true);
    });

    it('leaves the call joined if the provider fails', async () => {
        const f = relayFixture();
        f.mintRelay.mockRejectedValue(Error('fixture provider offline'));
        await (await f.receive(f.first, 'relay'))();
        expect(f.first.frames).toContainEqual({ t: 'media-error', reason: 'relay-unavailable' });
        expect(f.first.attachment.joined).toBe(true);
        expect(f.first.readyState).toBe(1);
    });
});

describe('Game Night call report witness', () => {
    const input = { request: 'a'.repeat(24), target: 'second', reason: 'Test concern', consent: true };

    it('refuses a guessed target when the reporter has never shared a visible call with them', async () => {
        const submit = vi.fn();
        const f = relayFixture(submit);
        f.block();
        f.reconcile();
        await f.receive(f.first, 'report', input);
        expect(f.first.frames.at(-1)).toMatchObject({ t: 'media-report', status: 'peer-unavailable' });
        expect(submit).not.toHaveBeenCalled();
    });

    it('keeps a bounded report witness after the target leaves and expires it', async () => {
        const submit = vi.fn(() => ({ ok: true }));
        const f = relayFixture(submit);
        f.reconcile();
        await f.receive(f.second, 'leave');
        expect(f.first.frames.at(-1)).toMatchObject({ peers: [], recentReportPeers: [{ id: 'second', nick: 'second' }] });
        f.advance(299_999);
        await f.receive(f.first, 'report', input);
        expect(f.first.frames.at(-1)).toMatchObject({ t: 'media-report', status: 'queued' });
        expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ target: null, reason: input.reason }));
        f.advance(1);
        await f.receive(f.first, 'report', input);
        expect(f.first.frames.at(-1)).toMatchObject({ t: 'media-report', status: 'peer-unavailable' });
        f.reconcile();
        expect(f.first.frames.at(-1)).toMatchObject({ recentReportPeers: [] });
        expect(f.first.attachment.reportPeers).toEqual([]);
        expect(submit).toHaveBeenCalledTimes(1);
    });
});
