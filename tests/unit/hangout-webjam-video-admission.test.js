// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { betaFetch } from '../../hangout-worker/src/beta-entry.mjs';
import { HangoutLobby } from '../../hangout-worker/src/lobby-do.mjs';
import { handleVideoAdmission, VIDEO_ADMISSION_INTERNAL } from '../../hangout-worker/src/webjam-video-admission.mjs';

const proof = { session_id: '1'.repeat(64), invite_digest: '2'.repeat(64) };
const request = (path = '/v1/check', value = proof) => new Request('https://private.example' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
});

function fixture() {
    const ids = ['host', 'guest'];
    const env = { HANGOUT_BETA_MODE: 'protected', HANGOUT_WEBJAM_VIDEO_ADMISSION: 'on' };
    const sockets = new Map(ids.map(id => {
        const attachment = { id, betaSid: id.padEnd(18, '0'), betaInviteVersion: '1', expiresAt: Date.now() + 60000 };
        return [id, { readyState: 1, deserializeAttachment: () => ({ ...attachment }) }];
    }));
    const lobby = Object.assign(Object.create(HangoutLobby.prototype), {
        env, authorityMode: false, authorityUnavailable: false, closedSockets: new WeakSet(),
        state: { blockConcurrencyWhile: operation => operation(), getWebSockets: id => [sockets.get(id)] },
        engine: { videoAdmissionParticipants: vi.fn(async () => ids) },
        sessionActive: vi.fn(async () => true), ready: Promise.resolve(),
    });
    const forward = vi.fn(req => lobby.fetch(req));
    env.LOBBY = { idFromName: name => name, get: () => ({ fetch: forward }) };
    return { env, lobby, forward, sockets };
}

describe('private WebJam video verifier', () => {
    it('passes a valid proof to the lobby and rechecks both live beta sessions', async () => {
        const { env, lobby, forward } = fixture();
        const response = await handleVideoAdmission(request('/v1/check', { ...proof, ignored: 'unused' }), env);
        expect(response.status).toBe(204);
        expect(await response.text()).toBe('');
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        const internal = forward.mock.calls[0][0];
        expect(new URL(internal.url).pathname).toBe(VIDEO_ADMISSION_INTERNAL);
        expect(lobby.engine.videoAdmissionParticipants.mock.calls).toEqual([
            [proof.session_id, proof.invite_digest], [proof.session_id, proof.invite_digest],
        ]);
        expect(lobby.sessionActive.mock.calls.map(([value]) => value.id)).toEqual(['host', 'guest']);
    });

    it('denies membership loss, beta revocation and a disconnected original socket', async () => {
        const { env, lobby, sockets } = fixture();
        lobby.engine.videoAdmissionParticipants.mockResolvedValueOnce(['host', 'guest']).mockResolvedValueOnce(null);
        expect((await handleVideoAdmission(request(), env)).status).toBe(403);
        lobby.sessionActive.mockImplementation(async ({ id }) => id !== 'guest');
        expect((await handleVideoAdmission(request(), env)).status).toBe(403);
        lobby.sessionActive.mockResolvedValue(true);
        sockets.get('guest').readyState = 3;
        expect((await handleVideoAdmission(request(), env)).status).toBe(403);
    });

    it('denies approval when a beta session changes during the authority read', async () => {
        const { env, lobby, sockets } = fixture();
        const socket = sockets.get('guest');
        const oldAttachment = socket.deserializeAttachment();
        lobby.sessionActive.mockImplementation(async ({ id }) => {
            if (id === 'guest') socket.deserializeAttachment = () => ({ ...oldAttachment, betaSid: 'new-session-000000' });
            return true;
        });
        expect((await handleVideoAdmission(request(), env)).status).toBe(403);
    });

    it('rejects invalid proof and keeps the public fetch and disabled feature away from the verifier', async () => {
        const { env, forward } = fixture();
        expect((await handleVideoAdmission(request('/v1/check', { session_id: 'bad' }), env)).status).toBe(403);
        expect((await handleVideoAdmission(request(), { ...env, HANGOUT_WEBJAM_VIDEO_ADMISSION: 'off' })).status).toBe(503);
        for (const path of ['/v1/check', VIDEO_ADMISSION_INTERNAL]) {
            expect((await betaFetch(request(path), env)).status).not.toBe(204);
        }
        expect(forward).not.toHaveBeenCalled();
    });
});
