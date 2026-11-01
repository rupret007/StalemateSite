// @vitest-environment node
// Actual engine and (for commit boundaries) actual SQLite/session/effect mapper.
// No production issuer/guardian, hosted transport or real user data is involved.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLobby } from '../../hangout-worker/src/lobby-core.mjs';
import { createLobbySessionAuthority, initializeLobbySessionAuthority } from '../../hangout-worker/src/lobby-session-authority.mjs';
import { writeLobbyEffects } from '../../hangout-worker/src/lobby-effect-records.mjs';
import { openDurableRecordSqlite } from '../support/durable-record-sqlite.mjs';

const NOW = 1800000000000, TOKEN = 'a'.repeat(32), cleanups = [];
const copy = value => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture() {
    let at = NOW;
    const frames = [], persisted = [], engine = createLobby({ now: () => at,
        send: (recipient, frame) => frames.push({ recipient, ...copy(frame) }), persist: (kind, value) => persisted.push([kind, copy(value)]) });
    const message = (id, frame) => engine.message(id, JSON.stringify(frame));
    for (const [id, nick] of [['writer', 'Writer'], ['reader', 'Reader']]) {
        await engine.connect({ id, dev: `device_${id}`, iph: `ip_${id}` }); await message(id, { t: 'hello', nick, age13: true, pmPeers: 1 });
    }
    frames.length = persisted.length = 0;
    return { engine, frames, persisted, message, advance: ms => { at += ms; } };
}

async function sqliteFixture() {
    const directory = await mkdtemp(join(tmpdir(), 'message-result-native-'));
    const driver = openDurableRecordSqlite(join(directory, 'records.sqlite'));
    cleanups.push(async () => { await driver.close(); await rm(directory, { recursive: true, force: true }); });
    const storage = { transaction: operation => driver.transaction(raw => operation({ ...raw,
        getAlarm: () => raw.get('__alarm__'), setAlarm: value => raw.put('__alarm__', value), deleteAlarm: () => raw.delete('__alarm__') })) };
    const fresh = createLobby({ now: () => NOW });
    const state = { net: fresh.snapshot(), rooms: fresh.roomSnapshot(), abuse: fresh.abuseSnapshot(), sessions: fresh.sessionSnapshot(),
        moderationQueue: { reports: [], held: [] }, aiReviews: [], modlog: [] };
    const env = { HANGOUT_SESSION_AUTHORITY: 'lobby-v1', HANGOUT_BETA_MODE: 'protected', HANGOUT_BETA_INVITE_VERSION: '1',
        HANGOUT_HMAC_KEY: 'synthetic-message-result-test-key-not-a-secret' };
    await initializeLobbySessionAuthority({ storage, env, state, now: NOW });
    const control = { afterEffects: null }, frames = [];
    const authority = createLobbySessionAuthority({ storage, env, now: () => NOW,
        writeEffects: async input => { await writeLobbyEffects(input); if (!input.costsOnly) await control.afterEffects?.(input); } });
    const engine = createLobby({ now: () => NOW, effectCommit: authority.effectCommit,
        send: (recipient, frame) => frames.push({ recipient, ...copy(frame) }) });
    const message = (id, frame) => engine.message(id, JSON.stringify(frame));
    for (const [id, nick] of [['writer', 'Writer'], ['reader', 'Reader']]) {
        const sid = `session-${id.padEnd(12, 'x')}`, expiresAt = NOW + 100000;
        expect((await authority.register({ sid, version: '1', exp: expiresAt, iph: `mint_${id.padEnd(17, 'x')}`.slice(0, 22) })).status).toBe(200);
        const binding = { id, betaSid: sid, betaInviteVersion: '1', dev: `device_${id}`, iph: `ip_${id}`, account: '', role: 'fan', admin: false,
            expiresAt, authorityRef: id, authorityRevision: 1 };
        await authority.bind(binding); await engine.connect(binding); await message(id, { t: 'hello', nick, age13: true, pmPeers: 1 });
    }
    frames.length = 0;
    return { engine, frames, authority, driver, control, message };
}

describe('caller-only negotiated message results', () => {
    it('returns a correlated refusal for the real default lobby slow window without publishing the second line', async () => {
        const f = await fixture(); await f.message('writer', { t: 'say', ch: '#stalemate', text: 'A first accepted message' });
        f.frames.length = f.persisted.length = 0;
        await f.message('writer', { t: 'say', ch: '#stalemate', text: 'Keep this rejected second message', clientMessageId: TOKEN });
        expect(f.frames.some(frame => frame.recipient === 'writer' && frame.text === 'Slow mode: one line every 3s.')).toBe(true);
        expect(f.frames.some(frame => frame.recipient === 'reader' && frame.t === 'line')).toBe(false);
        expect(f.frames.filter(frame => frame.t === 'message-result')).toEqual([{ recipient: 'writer', t: 'message-result', id: TOKEN, status: 'rejected' }]);
        expect(JSON.stringify(f.persisted)).not.toContain(TOKEN);
    });

    it('publishes no correlation token to peers, receipts, moderation or durable state', async () => {
        const f = await fixture(); await f.message('writer', { t: 'say', ch: '#stalemate', text: 'An accepted correlated message', clientMessageId: TOKEN });
        expect(f.frames.filter(frame => frame.t === 'message-result')).toEqual([{ recipient: 'writer', t: 'message-result', id: TOKEN, status: 'published' }]);
        expect(JSON.stringify(f.frames.filter(frame => frame.recipient !== 'writer' || frame.t !== 'message-result'))).not.toContain(TOKEN);
        expect(JSON.stringify(f.persisted)).not.toContain(TOKEN);
        expect(JSON.stringify(f.engine.sessionSnapshot())).not.toContain(TOKEN);
        expect(JSON.stringify(f.engine.adminState())).not.toContain(TOKEN);
    });

    it('distinguishes moderation-held text from published text', async () => {
        const f = await fixture();
        await f.message('writer', { t: 'say', ch: '#stalemate', text: 'you are such a loser', clientMessageId: TOKEN });
        expect(f.frames.some(frame => frame.recipient === 'reader' && frame.t === 'line')).toBe(false);
        expect(f.engine.adminState().held).toHaveLength(1);
        expect(f.frames.filter(frame => frame.t === 'message-result')).toEqual([{ recipient: 'writer', t: 'message-result', id: TOKEN, status: 'held' }]);
    });

    it('distinguishes a pending first PM request from delivery and preserves the ordinary PM scope', async () => {
        const f = await fixture(); f.advance(120001);
        await f.message('writer', { t: 'cmd', ch: 'pm:Reader', name: 'msg', pmExplicit: true, args: ['Reader', 'A private first message'], clientMessageId: TOKEN });
        expect(f.frames.some(frame => frame.t === 'pm-request' && frame.recipient === 'reader')).toBe(true);
        expect(f.frames.some(frame => frame.t === 'pm')).toBe(false);
        expect(f.frames.filter(frame => frame.t === 'message-result')).toEqual([{ recipient: 'writer', t: 'message-result', id: TOKEN, status: 'pending' }]);
        expect(JSON.stringify(f.persisted)).not.toContain(TOKEN);
    });

    it('confirms an ordinary open-PM operation only to its sender without tracking the prior pending token', async () => {
        const f = await fixture(); f.advance(120001);
        await f.message('writer', { t: 'cmd', ch: 'pm:Reader', name: 'msg', pmExplicit: true, args: ['Reader', 'First pending body'], clientMessageId: 'b'.repeat(32) });
        const pending = f.frames.find(frame => frame.t === 'pm-request' && frame.recipient === 'reader');
        expect(pending).toMatchObject({ peer: 'writer', ref: expect.stringMatching(/^[a-f0-9]{32}$/) });
        f.frames.length = 0;
        await f.message('reader', { t: 'cmd', name: 'accept', args: ['Writer'], ch: '#stalemate', pmPeer: pending.peer, pmRef: pending.ref });
        expect(f.frames.some(frame => frame.t === 'pm' && frame.recipient === 'reader' && frame.text === 'First pending body')).toBe(true);
        expect(f.frames.some(frame => frame.t === 'message-result')).toBe(false);
        const { ref } = f.frames.find(frame => frame.t === 'pm-open' && frame.recipient === 'writer');
        f.frames.length = f.persisted.length = 0;
        await f.message('writer', { t: 'say', ch: `pm:${ref}`, pmPeer: 'reader', pmRef: ref, text: 'An accepted private reply', clientMessageId: TOKEN });
        expect(f.frames.some(frame => frame.t === 'pm' && frame.recipient === 'reader' && frame.text === 'An accepted private reply')).toBe(true);
        expect(f.frames.filter(frame => frame.t === 'message-result')).toEqual([{ recipient: 'writer', t: 'message-result', id: TOKEN, status: 'published' }]);
        expect(JSON.stringify(f.frames.filter(frame => frame.t !== 'message-result'))).not.toContain(TOKEN);
        expect(JSON.stringify(f.persisted)).not.toContain(TOKEN);
        expect(JSON.stringify(f.engine.sessionSnapshot())).not.toContain(TOKEN);
    });

    it.each(['A public channel message', 'you are such a loser'])('does not mistake /msg channel routing for an ordinary PM result: %s', async text => {
        const f = await fixture();
        await f.message('writer', { t: 'cmd', ch: 'pm:#stalemate', name: 'msg', pmExplicit: true, args: ['#stalemate', text], clientMessageId: TOKEN });
        const published = f.frames.some(frame => frame.t === 'line' && frame.text === text);
        expect(published || f.engine.adminState().held.some(line => line.text === text)).toBe(true);
        expect(f.frames.some(frame => frame.t === 'message-result')).toBe(false);
    });

    it('withholds publication and its result until the real native effect transaction commits', async () => {
        const f = await sqliteFixture(), held = deferred(); let staged = false;
        f.control.afterEffects = async () => { staged = true; await held.promise; };
        const pending = f.message('writer', { t: 'say', ch: '#stalemate', text: 'Held behind actual SQLite', clientMessageId: TOKEN });
        try {
            await vi.waitFor(() => expect(staged).toBe(true)); expect(f.frames).toEqual([]);
        } finally { held.resolve(); }
        await pending;
        expect(f.frames.some(frame => frame.t === 'line' && frame.recipient === 'reader')).toBe(true);
        expect(f.frames.filter(frame => frame.t === 'message-result')).toEqual([{ recipient: 'writer', t: 'message-result', id: TOKEN, status: 'published' }]);
    });

    it('does not send a positive result after a real post-write SQLite transaction rollback', async () => {
        const f = await sqliteFixture(); let tripped = false;
        f.control.afterEffects = async () => { tripped = true; throw Error('Synthetic failure after actual staged writes'); };
        await f.message('writer', { t: 'say', ch: '#stalemate', text: 'Must not publish after rollback', clientMessageId: TOKEN });
        expect(tripped).toBe(true); expect(f.driver.stats.rollbacks).toBeGreaterThan(0);
        expect(f.frames.some(frame => frame.t === 'line' && frame.text === 'Must not publish after rollback')).toBe(false);
        expect(f.frames.some(frame => frame.t === 'message-result' && ['published', 'held', 'pending'].includes(frame.status))).toBe(false);
        expect(JSON.stringify(f.engine.sessionSnapshot())).not.toContain(TOKEN);
    });

    it.each([undefined, '', 'short', 'x'.repeat(100)])('keeps legacy or malformed correlation %s out of result frames', async clientMessageId => {
        const f = await fixture(); await f.message('writer', { t: 'say', ch: '#stalemate', text: 'Ordinary compatible message', ...(clientMessageId === undefined ? {} : { clientMessageId }) });
        expect(f.frames.some(frame => frame.t === 'line' && frame.recipient === 'reader')).toBe(true);
        expect(f.frames.some(frame => frame.t === 'message-result')).toBe(false);
    });
});
