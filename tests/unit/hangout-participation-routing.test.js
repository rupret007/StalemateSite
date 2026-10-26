// @vitest-environment node
// Production entry/DO boundaries: refusals must precede unfenced side effects.
import { describe, expect, it, vi } from 'vitest';
import worker, { HangoutRoom } from '../../hangout-worker/src/index.mjs';
import { HangoutLobby } from '../../hangout-worker/src/lobby-do.mjs';
import { betaFetch } from '../../hangout-worker/src/beta-entry.mjs';
import { signBeta } from '../../hangout-worker/src/beta-auth.mjs';
import { LOBBY_AUTHORITY_PATH } from '../../hangout-worker/src/lobby-session-authority.mjs';
const env = extra => ({ HANGOUT_PARTICIPATION_AUTHORITY: 'c3-v1', HANGOUT_SESSION_AUTHORITY: 'lobby-v1', HANGOUT_BETA_MODE: 'protected',
    HANGOUT_HMAC_KEY: 'h'.repeat(40), HANGOUT_BETA_INVITE_KEY: 'i'.repeat(40), HANGOUT_PREVIEW_KEY: 'p'.repeat(40),
    ASSETS: {}, LOBBY: {}, ROOMS: {}, QUOTA: {}, ...extra });
const deadBinding = () => ({ idFromName: vi.fn(() => 'owned'), get: vi.fn(() => { throw Error('unfenced binding called'); }) });
const sid = 'issued-beta-session-111111';

it.each(['/room?room=' + 'a'.repeat(64), '/turn'])('refuses direct Worker %s before quota, room or provider dispatch', async path => {
    const bindings = { QUOTA: deadBinding(), ROOMS: deadBinding(), TURN_BUDGET: deadBinding(), LOBBY: deadBinding() };
    const response = await worker.fetch(new Request('https://beta.example' + path, { headers: { Upgrade: 'websocket' } }), env(bindings));
    expect(response.status).toBe(503); for (const binding of Object.values(bindings)) expect(binding.get).not.toHaveBeenCalled();
});
it.each(['/room?room=' + 'a'.repeat(64), '/turn', '/join/'])('refuses real signed beta %s before unfenced admission', async path => {
    const checks = vi.fn(async request => { expect(new URL(request.url).pathname).toBe(LOBBY_AUTHORITY_PATH + 'check'); return Response.json({ reason: 'active', profile: null }); });
    const bindings = { LOBBY: { idFromName: () => 'stalemate', get: () => ({ fetch: checks }) }, QUOTA: deadBinding(), ROOMS: deadBinding(), TURN_BUDGET: deadBinding() };
    const assets = { fetch: vi.fn(() => { throw Error('unfenced audio asset requested'); }) };
    const config = env({ ...bindings, ASSETS: assets }), token = await signBeta('access', { v: 1, scope: 'guest', sid, version: '1', exp: Date.now() + 60000 }, config.HANGOUT_HMAC_KEY);
    const response = await betaFetch(new Request('https://beta.example' + path, { headers: { Cookie: '__Host-hangout-beta=' + token, Origin: 'https://beta.example', Upgrade: 'websocket' } }), config);
    expect(response.status).toBe(503); expect(checks).toHaveBeenCalledOnce();
    expect(assets.fetch).not.toHaveBeenCalled();
    for (const binding of [bindings.QUOTA, bindings.ROOMS, bindings.TURN_BUDGET]) expect(binding.get).not.toHaveBeenCalled();
});
it.each(['', 'unknown'])('refuses malformed mode %j before actual binding-only initialization or migration writes', async mode => {
    const transaction = vi.fn(() => { throw Error('must not touch storage'); }), registry = deadBinding();
    const state = { storage: { transaction }, blockConcurrencyWhile: fn => fn(), getWebSockets: () => [], waitUntil() {} };
    const lobby = new HangoutLobby(state, env({ HANGOUT_PARTICIPATION_AUTHORITY: mode, BETA_SESSIONS: registry })); await lobby.ready;
    for (const operation of ['initialize', 'migrate', 'rotate']) {
        const response = await lobby.fetch(new Request('https://binding' + LOBBY_AUTHORITY_PATH + operation, { method: 'POST', body: '{}' }));
        expect(response.status).toBe(503); expect((await response.json()).reason).toBe('participation authority unavailable');
    }
    expect(transaction).not.toHaveBeenCalled(); expect(registry.get).not.toHaveBeenCalled(); expect(lobby.engine).toBeUndefined();
});
it('retires restored unfenced private sockets while keeping authenticated disconnect cleanup available', async () => {
    const socket = value => ({ readyState: 1, value, sent: [], deserializeAttachment() { return this.value; }, serializeAttachment(v) { this.value = v; },
        close(code) { this.readyState = 3; this.closed = code; }, send(raw) { this.sent.push(raw); } });
    const a = socket({ v: 1, id: 'private-a', betaSid: sid, bucket: {} }), b = socket({ v: 1, id: 'private-b', betaSid: 'different-issued-session', bucket: {} });
    const state = { blockConcurrencyWhile: fn => fn(), getWebSockets: () => [a, b], getTags: ws => [ws.value.id],
        acceptWebSocket: vi.fn(), storage: { getAlarm: async () => null, setAlarm: vi.fn(), deleteAlarm: vi.fn() } };
    const room = new HangoutRoom(state, env()); await room.ready;
    expect([a.closed, b.closed]).toEqual([4401, 4401]);
    for (const target of [sid, 'unmatched-issued-session']) {
        const response = await room.fetch(new Request('https://binding/__beta/disconnect', { method: 'POST', headers: { 'X-Hangout-Identity': JSON.stringify({ betaSid: target }) } }));
        expect(response.status).toBe(200); expect(await response.text()).toBe('closed');
    }
    const refused = await room.fetch(new Request('https://binding/room?room=' + 'a'.repeat(64))); expect(refused.status).toBe(503);
    await room.webSocketMessage(a, 'opaque-unfenced-frame'); expect(a.sent).toEqual([]); expect(b.sent).toEqual([]); expect(state.acceptWebSocket).not.toHaveBeenCalled();
});
