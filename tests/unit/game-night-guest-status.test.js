import { describe, expect, it, vi } from 'vitest';

const markup = `<p data-guest-status role="status"></p>
<p data-guest-inviter hidden></p>
<h1 data-guest-game></h1>
<section data-guest-invite hidden><button type="button" data-guest-join>Join game</button></section>
<button type="button" data-guest-retry hidden>Try again</button>`;

async function load(status, body) {
    document.body.innerHTML = markup;
    window.location.hash = '#invite=abc';
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(body, { status })));
    await import('../../r/45662413410ed051/lobby/game-night-guest.js');
    await vi.waitFor(() => expect(document.querySelector('[data-guest-status]').textContent).not.toBe('Checking…'));
}

describe('expired Game Night invite', () => {
    it('tells the guest to ask the host for a new invite', async () => {
        await load(410, { error: 'This invitation has expired, was used, or the game is no longer waiting for a guest. Ask your host for a new invite.' });
        expect(document.querySelector('[data-guest-status]').textContent).toBe('This invite expired. Ask your host for a new invite.');
        expect(document.querySelector('[data-guest-retry]').hidden).toBe(true);
        expect(document.querySelector('[data-guest-invite]').hidden).toBe(true);
    });

    it('keeps Try again when the check fails for another reason', async () => {
        await load(503, { error: 'The invitation could not be confirmed. Try again.' });
        expect(document.querySelector('[data-guest-status]').textContent).toBe('Couldn’t check the invitation. Try again.');
        expect(document.querySelector('[data-guest-retry]').hidden).toBe(false);
    });
});
