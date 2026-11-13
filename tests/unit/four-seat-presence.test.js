import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    FOUR_GUEST_FIRST, FOUR_HOST_LEFT, FOUR_HOST_WAITING, FOUR_PRESENCE_MS,
    LOBBY_HOST_WAITING, LOBBY_INTRO, LOBBY_MATCH_ENDED, LOBBY_OPEN_SEAT,
    emptyFourSeatMemory, fourDropMessage, fourDropReason, fourOwnGameHref, hostGone, presentFourSeat
} from '../../r/45662413410ed051/lobby/four-seat-presence.mjs';
import { applyFourSeatPresence, installFourSeatPresence } from '../../r/45662413410ed051/lobby/four-seat-presence-client.mjs';

const NOW = 1_800_000_000_000;

function mount(status = '') {
    document.body.innerHTML = `
        <details class="four-match" data-four open>
            <div class="four-info">
                <p class="small game-note" data-four-status role="status" tabindex="-1">${status}</p>
            </div>
            <div data-four-board hidden>
                <div class="four-columns" data-four-columns></div>
                <table class="four-board" data-four-table></table>
            </div>
            <button type="button" data-four-leave hidden></button>
        </details>`;
    return document.querySelector('[data-four]');
}

function paint(root, status, { leave = '', hidden = false } = {}) {
    const leaveButton = root.querySelector('[data-four-leave]');
    leaveButton.hidden = hidden || leave === '';
    leaveButton.textContent = leave;
    root.querySelector('[data-four-status]').textContent = status;
    return applyFourSeatPresence(root);
}

afterEach(() => {
    document.body.innerHTML = '';
    document.querySelector('link[data-four-presence-style]')?.remove();
    window.history.replaceState(null, '', '/');
});

describe('Four seat waiting copy', () => {
    it('tells a waiting host the seat is open and keeps the board in view', () => {
        const view = presentFourSeat(emptyFourSeatMemory(), {
            status: LOBBY_HOST_WAITING,
            leaveLabel: 'Close match'
        });
        expect(view.status).toBe(FOUR_HOST_WAITING);
        expect(view.phase).toBe('waiting');
        expect(view.showBoard).toBe(true);
        expect(view.presence).toBe('Waiting for your friend…');
        expect(view.ownGame).toBe(false);
        expect(view.status).not.toBe('X goes first.');
    });

    it('tells a seated guest they are O and waiting on the first piece', () => {
        const view = presentFourSeat(emptyFourSeatMemory(), {
            status: 'X to play.',
            leaveLabel: 'Leave match'
        });
        expect(view.status).toBe(FOUR_GUEST_FIRST);
        expect(view.phase).toBe('waiting');
        expect(view.presence).toBe('Live · Host is at the table');
        expect(view.showBoard).toBe(false);
    });

    it('keeps a later wait from looking like a bare turn', () => {
        const waiting = presentFourSeat(emptyFourSeatMemory(), {
            status: 'O played column 2. X to play.',
            leaveLabel: 'Leave match'
        });
        expect(waiting.status).toBe('O played column 2. Waiting for X to move');
        expect(waiting.phase).toBe('waiting');
        expect(waiting.status).not.toMatch(/to play/);

        const yours = presentFourSeat(emptyFourSeatMemory(), {
            status: 'X played column 1. Your turn (O).'
        });
        expect(yours.status).toBe('X played column 1. Your turn (O).');
        expect(yours.phase).toBe('ready');

        const won = presentFourSeat(emptyFourSeatMemory(), { status: 'X played column 4. X wins.' });
        expect(won.status).toBe('X played column 4. X wins.');
    });

    it('leaves the unseated join line alone', () => {
        const view = presentFourSeat(emptyFourSeatMemory(), { status: LOBBY_OPEN_SEAT, leaveHidden: true });
        expect(view.status).toBe(LOBBY_OPEN_SEAT);
        expect(view.showBoard).toBe(false);
        expect(view.memory.seat).toBe('');
    });
});

describe('Four host-left', () => {
    it('treats a vanished host as host-left and offers a new game', () => {
        const seated = presentFourSeat(emptyFourSeatMemory(), {
            status: 'X to play.',
            leaveLabel: 'Leave match'
        });
        const left = presentFourSeat(seated.memory, { status: LOBBY_MATCH_ENDED, leaveHidden: true });
        expect(left.status).toBe(FOUR_HOST_LEFT);
        expect(left.phase).toBe('blocked');
        expect(left.ownGame).toBe(true);
        expect(left.presence).toBe('Host left');
        expect(left.showBoard).toBe(false);
    });

    it('does not tell the host or a guest who left that the host disappeared', () => {
        const host = presentFourSeat(emptyFourSeatMemory(), { status: 'Your turn (X).' });
        const hostEnded = presentFourSeat(host.memory, { status: LOBBY_MATCH_ENDED, leaveHidden: true });
        expect(hostEnded.status).toBe(LOBBY_MATCH_ENDED);
        expect(hostEnded.ownGame).toBe(false);

        const guest = presentFourSeat(emptyFourSeatMemory(), {
            status: 'X to play.',
            leaveLabel: 'Leave match'
        });
        const guestLeft = presentFourSeat(
            { ...guest.memory, selfLeft: true },
            { status: LOBBY_MATCH_ENDED, leaveHidden: true, selfLeft: true }
        );
        expect(guestLeft.status).toBe(LOBBY_MATCH_ENDED);
        expect(guestLeft.ownGame).toBe(false);
    });

    it('keeps a finished match from turning into host-left', () => {
        let memory = presentFourSeat(emptyFourSeatMemory(), {
            status: 'X to play.',
            leaveLabel: 'Leave match'
        }).memory;
        memory = presentFourSeat(memory, { status: 'X played column 4. X wins.' }).memory;
        const ended = presentFourSeat(memory, { status: LOBBY_MATCH_ENDED, leaveHidden: true });
        expect(ended.status).toBe(LOBBY_MATCH_ENDED);
        expect(ended.ownGame).toBe(false);
    });

    it('uses a 30 second silence only when membership is unknown', () => {
        expect(hostGone({ guestSeated: false, hostConnected: false })).toBe(false);
        expect(hostGone({ guestSeated: true, hostConnected: false })).toBe(true);
        expect(hostGone({
            guestSeated: true,
            hostConnected: true,
            hostSeenAt: NOW - FOUR_PRESENCE_MS - 1,
            now: NOW
        })).toBe(false);
        expect(hostGone({ guestSeated: true, hostSeenAt: NOW - FOUR_PRESENCE_MS, now: NOW })).toBe(false);
        expect(hostGone({ guestSeated: true, hostSeenAt: NOW - FOUR_PRESENCE_MS - 1, now: NOW })).toBe(true);
        expect(hostGone({ guestSeated: true })).toBe(false);

        const seated = presentFourSeat(emptyFourSeatMemory(), {
            status: 'X to play.',
            leaveLabel: 'Leave match'
        });
        const dropped = presentFourSeat(seated.memory, {
            status: 'X to play.',
            leaveLabel: 'Leave match',
            hostConnected: false
        });
        expect(dropped.status).toBe(FOUR_HOST_LEFT);
        expect(fourDropReason({ hostLeft: true, yourTurn: true })).toBe('host-left');
        expect(fourDropReason({ waiting: true })).toBe('waiting');
        expect(fourDropReason({ finished: true })).toBe('finished');
        expect(fourDropReason({ yourTurn: false })).toBe('wrong-turn');
        expect(fourDropReason({ yourTurn: true, columnOk: false })).toBe('illegal-move');
        expect(fourDropReason({ yourTurn: true })).toBe('');
        expect(fourDropMessage('host-left')).toBe(FOUR_HOST_LEFT);
        expect(fourDropMessage('wrong-turn')).toBe('Waiting for the other player to move.');
    });

    it('sends a guest back through the existing Game Night entrance', () => {
        expect(fourOwnGameHref('')).toBe('/beta/?game-night=1');
        expect(fourOwnGameHref('?via=rad-dad')).toBe('/beta/?game-night=1&via=rad-dad');
        expect(fourOwnGameHref('via=stalemate')).toBe('/beta/?game-night=1&via=stalemate');
        expect(fourOwnGameHref('via=rad-dad&via=stalemate')).toBe('/beta/?game-night=1');
        expect(fourOwnGameHref('via=other')).toBe('/beta/?game-night=1');
    });
});

describe('Four seat presence on the table', () => {
    it('paints the host wait, then removes the stand-in board once the real one exists', () => {
        const root = mount();
        paint(root, LOBBY_HOST_WAITING, { leave: 'Close match' });
        const status = root.querySelector('[data-four-status]');
        const board = root.querySelector('[data-four-board]');
        expect(status.textContent).toBe(FOUR_HOST_WAITING);
        expect(status.dataset.state).toBe('waiting');
        expect(board.hidden).toBe(false);
        expect(root.querySelector('[data-four-presence-label]').textContent).toBe('Waiting for your friend…');
        expect(root.querySelectorAll('[data-four-columns] button')).toHaveLength(7);
        expect(root.querySelectorAll('[data-four-table] td')).toHaveLength(42);
        expect(root.querySelector('[data-four-own-game]').hidden).toBe(true);

        const real = document.createElement('button');
        real.type = 'button';
        real.textContent = '1';
        root.querySelector('[data-four-columns]').append(real);
        paint(root, 'Your turn (X).', { leave: 'Leave match' });
        expect(status.textContent).toBe('Your turn (X).');
        expect(status.hasAttribute('data-state')).toBe(false);
        expect(root.querySelectorAll('[data-four-presence-placeholder]')).toHaveLength(0);
        expect(root.querySelectorAll('[data-four-columns] button')).toHaveLength(1);
        expect(root.querySelector('[data-four-presence]').hidden).toBe(true);
    });

    it('shows host-left to the guest and keeps the host match-ended line exact', () => {
        const guest = mount();
        installFourSeatPresence(document);
        paint(guest, 'X to play.', { leave: 'Leave match' });
        expect(guest.querySelector('[data-four-status]').textContent).toBe(FOUR_GUEST_FIRST);
        paint(guest, LOBBY_MATCH_ENDED, { hidden: true });
        const link = guest.querySelector('[data-four-own-game] a');
        expect(guest.querySelector('[data-four-status]').textContent).toBe(FOUR_HOST_LEFT);
        expect(guest.querySelector('[data-four-status]').dataset.state).toBe('blocked');
        expect(guest.querySelector('[data-four-own-game]').hidden).toBe(false);
        expect(link.textContent).toBe('Start your own game');
        expect(link.getAttribute('href')).toBe('/beta/?game-night=1');
        expect(guest.querySelector('[data-four-board]').hidden).toBe(true);

        window.history.replaceState(null, '', '/r/lobby/?via=rad-dad');
        paint(guest, LOBBY_MATCH_ENDED, { hidden: true });
        expect(link.getAttribute('href')).toBe('/beta/?game-night=1&via=rad-dad');

        const host = mount();
        paint(host, 'Your turn (X).', { leave: 'Leave match' });
        paint(host, LOBBY_MATCH_ENDED, { hidden: true });
        expect(host.querySelector('[data-four-status]').textContent).toBe(LOBBY_MATCH_ENDED);
        expect(host.querySelector('[data-four-own-game]').hidden).toBe(true);
    });

    it('does not call a guest leave host-left', () => {
        const root = mount();
        installFourSeatPresence(document);
        paint(root, 'X to play.', { leave: 'Leave match' });
        root.querySelector('[data-four-leave]').click();
        paint(root, LOBBY_MATCH_ENDED, { hidden: true });
        expect(root.querySelector('[data-four-status]').textContent).toBe(LOBBY_MATCH_ENDED);
        expect(root.querySelector('[data-four-own-game]').hidden).toBe(true);
    });

    it('follows a lobby status change without a second apply call', async () => {
        const root = mount(LOBBY_INTRO);
        expect(installFourSeatPresence(document)).toBe(true);
        expect(installFourSeatPresence(document)).toBe(false);
        root.querySelector('[data-four-leave]').hidden = false;
        root.querySelector('[data-four-leave]').textContent = 'Close match';
        root.querySelector('[data-four-status]').textContent = LOBBY_HOST_WAITING;
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(root.querySelector('[data-four-status]').textContent).toBe(FOUR_HOST_WAITING);
        expect(document.querySelector('link[data-four-presence-style]').getAttribute('href')).toMatch(/four-seat-presence\.css$/);
    });

    it('is loaded by the lobby keepalive module', async () => {
        const source = await readFile(join(process.cwd(), 'r/45662413410ed051/lobby/idle-heartbeat.mjs'), 'utf8');
        expect(source).toContain("import { installFourSeatPresence } from './four-seat-presence-client.mjs'");
        expect(source).toContain("document.querySelector?.('[data-four]')");
        expect(source).toContain('installFourSeatPresence(document)');
    });
});
