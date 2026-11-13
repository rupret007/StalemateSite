// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHESS_GAME, JOIN_CHESS_LABEL, OFFER_MIN_PX, createRoomOffer, raiseInRoomOffer } from '../../r/45662413410ed051/lobby/bridge-room-offer.mjs';

const ROOM = '#jam-live';
const HOST = 'host-session-0001';
const REF = 'b'.repeat(32);
const MATCH = 'match-chess-0001';
const HASH = 'a'.repeat(64);
const NOW = Date.parse('2026-11-13T12:00:00Z');

function harness(result = { ok: true, status: 200, body: { granted: 1, standby: 0 } }) {
    const calls = [];
    const offer = createRoomOffer({
        room: ROOM,
        register: async payload => {
            calls.push(payload);
            return result;
        }
    });
    return { offer, calls };
}

const confirm = (offer, extra = {}) => offer.confirmPlay({
    hostId: HOST, hostSubject: HOST, members: [HOST, 'guest-1'], ref: REF, match: MATCH, hash: HASH, now: NOW, ...extra
});

describe('bridge room offer', () => {
    it('registers one Chess seat in the current room after one Play confirm', async () => {
        const { offer, calls } = harness();
        const first = await confirm(offer);
        expect(first).toMatchObject({ ok: true, status: 200, shareSheet: false, secondRoom: false, room: ROOM });
        expect(calls).toEqual([{ room: ROOM, game: CHESS_GAME, match: MATCH, hostSubject: HOST, hashes: [HASH], now: NOW, ref: REF }]);
        expect(await confirm(offer)).toMatchObject({ ok: false, reason: 'already-confirmed', shareSheet: false, secondRoom: false });
        expect(calls).toHaveLength(1);
    });

    it('reserves once when a second confirmation arrives during registration', async () => {
        let finish;
        const pending = new Promise(resolve => { finish = resolve; });
        const calls = [];
        const offer = createRoomOffer({ room: ROOM, register: async payload => {
            calls.push(payload);
            return pending;
        } });
        const members = [HOST, 'guest-1'];
        const first = confirm(offer, { members });
        const second = confirm(offer, { hash: 'd'.repeat(64) });
        members.push('late-guest');
        finish({ ok: true, status: 200, body: { granted: 1, standby: 0 } });
        expect(await first).toMatchObject({ ok: true });
        expect(await second).toMatchObject({ ok: false, status: 409, reason: 'already-confirmed' });
        expect(calls).toHaveLength(1);
        expect(offer.offerFor('guest-1')).not.toBeNull();
        expect(offer.offerFor('late-guest')).toBeNull();
    });

    it('shows one Join Chess button, at least 44px, only to people already in the room', async () => {
        const { offer } = harness();
        expect(offer.render(document, 'guest-1')).toBeNull();
        await confirm(offer, { members: [HOST, 'guest-1', 'guest-2'] });
        expect(offer.offerFor(HOST)).toBeNull();
        expect(offer.offerFor('someone-else')).toBeNull();
        const button = offer.render(document, 'guest-1');
        document.body.append(button);
        expect(document.querySelectorAll('button')).toHaveLength(1);
        expect(button.textContent).toBe(JOIN_CHESS_LABEL);
        expect(parseFloat(button.style.minHeight)).toBeGreaterThanOrEqual(OFFER_MIN_PX);
        expect(button.style.minHeight).toBe('44px');
        expect(document.querySelector('[role="dialog"], [data-share]')).toBeNull();
        expect(offer.offerFor('guest-2')).toMatchObject({ label: JOIN_CHESS_LABEL, room: ROOM, shareSheet: false, secondRoom: false });
    });

    it('does not register when the host is alone or the room would change', async () => {
        const { offer, calls } = harness();
        expect(await confirm(offer, { members: [HOST] })).toMatchObject({ ok: false, reason: 'nobody-waiting', shareSheet: false });
        expect(await confirm(offer, { members: ['guest-1'] })).toMatchObject({ ok: false, reason: 'not-in-room' });
        expect(await confirm(offer, { hash: 'not-a-hash' })).toMatchObject({ ok: false, reason: 'unavailable' });
        expect(calls).toEqual([]);
        expect(() => createRoomOffer({ room: '#game-abcdefxabcdef', register: () => {} })).toThrow(/WebJam room/);
    });

    it('leaves the confirm unused when the seat is not granted', async () => {
        const { offer, calls } = harness({ ok: false, status: 403, body: { error: 'unavailable' } });
        expect(await confirm(offer)).toMatchObject({ ok: false, shareSheet: false, secondRoom: false, room: ROOM });
        expect(offer.offerFor('guest-1')).toBeNull();
        expect(calls).toHaveLength(1);
    });

    it('can confirm again after registration fails', async () => {
        let calls = 0;
        const offer = createRoomOffer({ room: ROOM, register: async () => {
            calls++;
            if (calls === 1) throw new Error('fixture unavailable');
            return { ok: true, status: 200, body: { granted: 1, standby: 0 } };
        } });
        expect(await confirm(offer)).toMatchObject({ ok: false, status: 503 });
        expect(await confirm(offer)).toMatchObject({ ok: true });
        expect(calls).toBe(2);
    });

    it('raises the existing in-room offer control to 44px', () => {
        const button = document.createElement('button');
        button.className = 'btn btn--small';
        button.setAttribute('data-game-offer-join', '');
        button.style.minHeight = '38px';
        raiseInRoomOffer(button);
        expect(button.style.minHeight).toBe('44px');
        const other = document.createElement('button');
        other.style.minHeight = '38px';
        raiseInRoomOffer(other);
        expect(other.style.minHeight).toBe('38px');
        const css = readFileSync(join(process.cwd(), 'r/45662413410ed051/lobby/lobby.css'), 'utf8');
        expect(css).toMatch(/\.game-offer \[data-game-offer-join\]\s*\{[^}]*min-height:\s*44px/);
    });
});
