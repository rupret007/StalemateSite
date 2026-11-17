import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    history.replaceState(null, '', '/');
    document.body.replaceChildren();
});

it('tells a returning guest to wait when reconnects are limited, then handles an expired seat', async () => {
    document.body.innerHTML = `
        <main data-resume-guest>
            <h1 data-guest-game>Game Night</h1>
            <p data-guest-status role="status">Connecting…</p>
            <section data-guest-invite hidden><button data-guest-join>Join game</button></section>
            <button data-guest-retry hidden>Try again</button>
            <button data-guest-fresh hidden>Ask the host for a fresh link</button>
        </main>
    `;
    const tableId = '11111111-1111-4111-8111-111111111111';
    const otherTable = '22222222-2222-4222-8222-222222222222';
    const pass = 'a'.repeat(64);
    const saved = new Map([
        ['gn:pass:' + tableId, pass],
        ['gn:pass:' + otherTable, 'b'.repeat(64)],
        ['gn:last-table', otherTable]
    ]);
    vi.stubGlobal('localStorage', { getItem: key => saved.get(key), removeItem: key => saved.delete(key) });
    history.replaceState(null, '', '/r/45662413410ed051/lobby/?game-guest=1&table=' + tableId);
    const request = vi.fn()
        .mockResolvedValueOnce(Response.json({ error: 'Reconnect allowance reached. Try again in a minute.' }, { status: 429 }))
        .mockResolvedValueOnce(Response.json({}, { status: 410 }));
    vi.stubGlobal('fetch', request);

    await import('../../r/45662413410ed051/lobby/game-night-guest.js');

    const status = document.querySelector('[data-guest-status]');
    const retry = document.querySelector('[data-guest-retry]');
    const fresh = document.querySelector('[data-guest-fresh]');
    await vi.waitFor(() => expect(retry.hidden).toBe(false));
    expect(status.textContent).toBe('Too many reconnect attempts. Wait a minute, then try again.');
    expect(document.activeElement).toBe(retry);
    expect(fresh.hidden).toBe(true);
    expect(saved.get('gn:pass:' + tableId)).toBe(pass);

    retry.click();
    await vi.waitFor(() => expect(fresh.hidden).toBe(false));
    expect(retry.hidden).toBe(true);
    expect(status.textContent).toBe('This invite is no longer available. Ask your host for a new one.');
    expect(saved.has('gn:pass:' + tableId)).toBe(false);
    expect(saved.get('gn:pass:' + otherTable)).toBe('b'.repeat(64));
    expect(saved.get('gn:last-table')).toBe(otherTable);
    expect(request.mock.calls.map(([url, options]) => [url, JSON.parse(options.body)])).toEqual([
        ['/beta/game-night/invitation/resume', { tableId, pass }],
        ['/beta/game-night/invitation/resume', { tableId, pass }]
    ]);
});

it('focuses retry when an invite check fails and moves focus to Join once recovered', async () => {
    document.body.innerHTML = `
        <main>
            <h1 data-guest-game>Game Night</h1>
            <p data-guest-inviter hidden></p>
            <p data-guest-status role="status">Checking your invitation…</p>
            <section data-guest-invite hidden><button data-guest-join>Join game</button></section>
            <button data-guest-retry hidden>Try again</button>
        </main>
    `;
    history.replaceState(null, '', '/beta/game-night/guest#invite=fixture');
    const request = vi.fn()
        .mockResolvedValueOnce(Response.json({}, { status: 503 }))
        .mockResolvedValueOnce(Response.json({ game: 'Turdanoid Brick Race', host: 'Test host' }));
    vi.stubGlobal('fetch', request);
    await import('../../r/45662413410ed051/lobby/game-night-guest.js');

    const status = document.querySelector('[data-guest-status]');
    const retry = document.querySelector('[data-guest-retry]');
    const join = document.querySelector('[data-guest-join]');
    await vi.waitFor(() => expect(retry.hidden).toBe(false));
    expect(status.textContent).toBe('Couldn’t check the invitation. Try again.');
    expect(document.activeElement).toBe(retry);

    retry.click();
    await vi.waitFor(() => expect(document.activeElement).toBe(join));
    expect(retry.hidden).toBe(true);
    expect(request.mock.calls.map(([url]) => url)).toEqual(Array(2).fill('/beta/game-night/invitation/details'));
});
