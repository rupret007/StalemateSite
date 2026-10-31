// @vitest-environment node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sources = ['countdown.js', 'script.js', 'js/site-track.js']
    .map((file) => readFileSync(join(root, file), 'utf8'));
const TICKET_URL = 'https://studio801.ticketspice.com/rockin-october';
const TICKET_EVENT = 'show-ticket-rockin-october';
const BEFORE_SHOW = Date.parse('2026-10-24T16:44:59-05:00');

describe('homepage ticket click tracking', () => {
    let window;

    beforeEach(() => {
        // External scripts/assets are not loaded; only the local sources below run.
        const dom = new JSDOM(html, {
            runScripts: 'outside-only',
            url: 'https://rupret007.github.io/StalemateSite/'
        });
        window = dom.window;
        window.smTrack = vi.fn();
        vi.spyOn(window.Date, 'now').mockReturnValue(BEFORE_SHOW);
        // Cancel navigation without stopping either analytics click listener.
        window.document.addEventListener('click', (event) => event.preventDefault(), true);
        sources.forEach((source) => window.eval(source));
        window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
        window.StalemateCountdown.stop();
    });

    afterEach(() => {
        window?.StalemateCountdown?.stop();
        window?.close();
    });

    function clickEvents(link) {
        window.smTrack.mockClear();
        const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
        expect(link.dispatchEvent(event)).toBe(false);
        expect(event.defaultPrevented).toBe(true);
        return window.smTrack.mock.calls.map(([name]) => name);
    }

    it.each(['show-cta-header', 'show-cta-hero', 'show-cta-under-video'])(
        'records one ticket event and one %s placement event',
        (placement) => {
            const link = window.document.querySelector(`[data-track="${placement}"]`);
            expect(link).not.toBeNull();
            expect(link.textContent.trim()).toBe('Get Saturday tickets');
            expect(link.getAttribute('href')).toBe(TICKET_URL);
            expect(clickEvents(link).sort()).toEqual([TICKET_EVENT, placement].sort());
        }
    );

    it('retains the festival information category without a ticket event', () => {
        const link = window.document.querySelector('a[href="https://rockinoctober.com"]');
        expect(link).not.toBeNull();
        expect(clickEvents(link)).toEqual(['show-details']);
    });

    it('uses a fixed event for the approved destination and ignores unrelated TicketSpice URLs', () => {
        const privateQuery = '?buyer=private-attendee%40example.test&band=private-band&next=private-event';
        const cases = [
            [TICKET_URL + privateQuery, [TICKET_EVENT]],
            [TICKET_URL + privateQuery + '#private-fragment', [TICKET_EVENT]],
            ['https://studio801.ticketspice.com/private-event' + privateQuery, []],
            ['https://studio801.ticketspice.com/rockin-october/private-event' + privateQuery, []],
            ['https://studio801.ticketspice.com/?event=rockin-october&buyer=private-attendee', []],
            ['https://other.ticketspice.com/rockin-october' + privateQuery, []],
            ['https://studio801.ticketspice.com.example.test/rockin-october' + privateQuery, []]
        ];

        for (const [href, expected] of cases) {
            const link = window.document.createElement('a');
            link.href = href;
            link.textContent = 'Get tickets for private-attendee';
            window.document.body.appendChild(link);
            expect(clickEvents(link), href).toEqual(expected);
            link.remove();
        }
    });
});
