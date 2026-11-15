// @vitest-environment node
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { bindGameOfferChannel, GAME_OFFER_LABEL } from '../../hangout-worker/web-join-chess/game-offer.js';

describe('web join chess full table offer', () => {
    it('shows the open seat message for a full table', () => {
        const dom = new JSDOM('<div id="offer"></div>');
        const root = dom.window.document.getElementById('offer');
        const listeners = new Map();
        const channel = {
            label: GAME_OFFER_LABEL,
            addEventListener: (type, listener) => listeners.set(type, listener)
        };
        expect(bindGameOfferChannel(channel, { authorized: () => true, root })).toBe(true);

        listeners.get('message')({ data: JSON.stringify({ game: 'chess', hostName: 'Host', state: 'full' }) });

        expect(root.textContent).toContain('Table full. You’re in line for the next open seat.');
        dom.window.close();
    });
});
