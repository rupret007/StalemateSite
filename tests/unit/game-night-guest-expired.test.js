import { afterEach, describe, expect, it, vi } from 'vitest';

const html = `<main>
<p data-guest-inviter hidden></p>
<h1 data-guest-game>Game Night</h1>
<p data-guest-status role="status">Checking your invitation…</p>
<section data-guest-invite hidden><button type="button" data-guest-join>Join game</button></section>
<button type="button" data-guest-retry hidden>Try again</button>
</main>`;

async function loadGuest(status, body) {
    document.body.innerHTML = html;
    history.replaceState({ gameNightInvite: { code: 'invite-code', attempt: 'attempt-1' } }, '', location.pathname);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
        status, headers: { 'Content-Type': 'application/json' }
    })));
    vi.resetModules();
    await import('../../r/45662413410ed051/lobby/game-night-guest.js');
    await vi.waitFor(() => {
        expect(fetch).toHaveBeenCalled();
    });
}

describe('expired Game Night invite', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        document.body.replaceChildren();
    });

    it('says the invite expired and offers no button that does nothing', async () => {
        await loadGuest(410, { error: 'This invitation is invalid or has expired. Ask your host for a new invite.' });
        const status = document.querySelector('[data-guest-status]');
        await vi.waitFor(() => expect(status.textContent).toBe('This invite expired. Ask your host for a new invite.'));
        expect(document.querySelector('[data-guest-retry]').hidden).toBe(true);
        expect(document.querySelector('[data-guest-invite]').hidden).toBe(true);
        expect(history.state).toBeNull();
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('keeps Try again when the check fails for another reason', async () => {
        await loadGuest(503, { error: 'Game invitations are temporarily unavailable.' });
        const retry = document.querySelector('[data-guest-retry]');
        await vi.waitFor(() => expect(retry.hidden).toBe(false));
        expect(document.querySelector('[data-guest-status]').textContent).toBe('Couldn’t check the invitation. Try again.');
        expect(retry.textContent).toBe('Try again');
        retry.click();
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    });
});
