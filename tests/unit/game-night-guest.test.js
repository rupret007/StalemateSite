import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.unstubAllGlobals();
    history.replaceState(null, '', '/');
    document.body.replaceChildren();
});

it('moves keyboard focus from Retry to Join when the invitation check recovers', async () => {
    document.body.innerHTML = `
        <h1 data-guest-game>Game Night</h1>
        <p data-guest-status role="status"></p>
        <p data-guest-inviter hidden></p>
        <section data-guest-invite hidden>
            <p id="guest-agreement">By joining, you confirm you’re 13+.</p>
            <button type="button" data-guest-join>Join game</button>
        </section>
        <button type="button" data-guest-retry hidden>Try again</button>
        <button type="button" data-guest-fresh hidden>Ask the host for a fresh link</button>
    `;
    history.replaceState(null, '', '/beta/game-night/guest#invite=fixture');
    const fetchInvite = vi.fn()
        .mockRejectedValueOnce(new TypeError('Connection lost'))
        .mockResolvedValueOnce(Response.json({ game: 'Royal Flush Chess', host: 'Test host' }));
    vi.stubGlobal('fetch', fetchInvite);
    vi.stubGlobal('localStorage', { getItem: () => null });

    await import('../../r/45662413410ed051/lobby/game-night-guest.js');

    const retry = document.querySelector('[data-guest-retry]');
    const join = document.querySelector('[data-guest-join]');
    const status = document.querySelector('[data-guest-status]');
    await vi.waitFor(() => expect(retry.hidden).toBe(false));
    expect(status.textContent).toBe('Couldn’t check the invitation. Try again.');

    retry.focus();
    retry.click();
    await vi.waitFor(() => expect(join.closest('section').hidden).toBe(false));
    expect(document.querySelector('[data-guest-game]').textContent).toBe('Royal Flush Chess');
    expect(document.querySelector('[data-guest-inviter]').textContent).toBe('Test host invited you to play.');
    expect(document.activeElement).toBe(join);
    expect(fetchInvite.mock.calls.map(([url]) => url)).toEqual([
        '/beta/game-night/invitation/details', '/beta/game-night/invitation/details'
    ]);
});
