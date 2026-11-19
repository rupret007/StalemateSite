import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); });

afterEach(() => {
    vi.unstubAllGlobals();
    history.replaceState(null, '', '/');
    document.body.replaceChildren();
});

it.each(['duplicate activation', 'focus departure'])('keeps the expired-invite share orderly during %s', async (scenario) => {
    document.body.innerHTML = `
        <h1 data-guest-game>Game Night</h1>
        <p data-guest-status role="status"></p>
        <section data-guest-invite hidden><button data-guest-join>Join game</button></section>
        <button data-guest-retry hidden>Try again</button>
        <button data-guest-fresh hidden>Ask the host for a fresh link</button>
        <p data-guest-fresh-message tabindex="-1" hidden></p>
        <button id="other-control">Other action</button>
    `;
    history.replaceState(null, '', '/beta/game-night/guest');
    let failShare;
    const pendingShare = new Promise((resolve, reject) => { failShare = reject; });
    const share = vi.fn(() => pendingShare);
    const writeText = vi.fn().mockRejectedValue(new DOMException('Blocked', 'NotAllowedError'));
    vi.stubGlobal('navigator', Object.assign(Object.create(window.navigator), { share, clipboard: { writeText } }));
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await import('../../r/45662413410ed051/lobby/game-night-guest.js');

    const ask = document.querySelector('[data-guest-fresh]');
    const message = document.querySelector('[data-guest-fresh-message]');
    const other = document.getElementById('other-control');
    expect(ask.hidden).toBe(false);
    ask.focus();
    ask.click();
    if (scenario === 'duplicate activation') ask.click();
    else other.focus();
    failShare(new DOMException('Share unavailable', 'NotAllowedError'));
    await vi.waitFor(() => expect(message.hidden).toBe(false));
    expect(document.activeElement).toBe(scenario === 'focus departure' ? other : message);
    expect(share).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
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

it.each(['Royal Flush Chess', 'TurdSpades'])('moves focus to Join after retrying a %s invitation', async game => {
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
    const request = vi.fn()
        .mockResolvedValueOnce(Response.json({ error: 'Temporary connection failure.' }, { status: 503 }))
        .mockResolvedValueOnce(Response.json({ game, host: 'Fixture host' }));
    vi.stubGlobal('fetch', request);
    vi.stubGlobal('localStorage', { getItem: () => null });

    await import('../../r/45662413410ed051/lobby/game-night-guest.js');

    const retry = document.querySelector('[data-guest-retry]');
    const join = document.querySelector('[data-guest-join]');
    await vi.waitFor(() => expect(retry.hidden).toBe(false));
    retry.focus();
    retry.click();
    await vi.waitFor(() => expect(join.closest('section').hidden).toBe(false));
    expect(document.querySelector('[data-guest-game]').textContent).toBe(game);
    expect(document.querySelector('[data-guest-inviter]').textContent).toBe('Fixture host invited you to play.');
    expect(retry.hidden).toBe(true);
    expect(document.activeElement).toBe(join);
    expect(request.mock.calls.map(([path]) => path)).toEqual(Array(2).fill('/beta/game-night/invitation/details'));
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

it.each([false, true])('lets a refreshed guest correct a rejected nickname (details retry: %s)', async detailsRetry => {
    document.body.innerHTML = `
        <h1 data-guest-game>Game Night</h1>
        <p data-guest-inviter hidden></p>
        <p id="guest-invitation-status" data-guest-status role="status"></p>
        <section data-guest-invite hidden>
            <form>
                <label hidden>Your nickname<input data-guest-name></label>
                <button type="submit" data-guest-join>Join game</button>
            </form>
        </section>
        <button data-guest-retry hidden>Try again</button>
        <button data-guest-fresh hidden>Ask the host for a fresh link</button>
    `;
    const pass = 'a'.repeat(64);
    history.replaceState({ gameNightInvite: {
        code: 'fixture', attempt: 'resume-attempt', pass, confirmedGame: 'Royal Flush Chess', nick: 'TakenName'
    } }, '', '/beta/game-night/guest');
    const reason = 'That nickname is taken. Choose another.';
    const request = vi.fn().mockResolvedValueOnce(Response.json({ error: reason }, { status: 422 }));
    if (detailsRetry) request.mockResolvedValueOnce(Response.json({}, { status: 503 }));
    request.mockResolvedValueOnce(Response.json({ game: 'Royal Flush Chess', host: 'Fixture host', guestName: 'Suggested' }));
    request.mockResolvedValueOnce(Response.json({ error: 'This invite ended.' }, { status: 410 }));
    vi.stubGlobal('fetch', request);
    vi.stubGlobal('localStorage', { getItem: () => null });

    await import('../../r/45662413410ed051/lobby/game-night-guest.js');

    const status = document.querySelector('[data-guest-status]');
    const form = document.querySelector('[data-guest-invite]');
    const name = document.querySelector('[data-guest-name]');
    const join = document.querySelector('[data-guest-join]');
    const retry = document.querySelector('[data-guest-retry]');
    if (detailsRetry) {
        await vi.waitFor(() => expect(retry.hidden).toBe(false));
        expect(document.activeElement).toBe(retry);
        expect(status.textContent).toBe('Couldn’t check the invitation. Try again.');
        retry.click();
    }
    await vi.waitFor(() => expect(form.hidden).toBe(false));
    expect(name.closest('label').hidden).toBe(false);
    expect(name.disabled).toBe(false);
    expect(name.value).toBe('TakenName');
    expect(document.activeElement).toBe(name);
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(name.getAttribute('aria-describedby')).toBe(status.id);
    expect(status.textContent).toBe(reason);
    expect(retry.hidden).toBe(true);
    expect(join.disabled).toBe(false);
    expect(history.state.gameNightInvite.confirmedGame).toBe('');

    name.value = 'AvailableName';
    join.click();
    await vi.waitFor(() => expect(document.querySelector('[data-guest-fresh]').hidden).toBe(false));
    expect(name.hasAttribute('aria-invalid')).toBe(false);
    expect(name.hasAttribute('aria-describedby')).toBe(false);
    expect(request.mock.calls.map(([url]) => url)).toEqual([
        '/beta/game-night/invitation/accept',
        ...Array(detailsRetry ? 2 : 1).fill('/beta/game-night/invitation/details'),
        '/beta/game-night/invitation/accept'
    ]);
    const firstAttempt = JSON.parse(request.mock.calls[0][1].body);
    expect(firstAttempt).toMatchObject({ code: 'fixture', nick: 'TakenName', attempt: 'resume-attempt', age13: true });
    expect(JSON.parse(request.mock.calls.at(-1)[1].body)).toEqual({ ...firstAttempt, nick: 'AvailableName' });
});

it('submits the nickname form through the existing invitation attempt only once', async () => {
    document.body.innerHTML = `
        <h1 data-guest-game>Game Night</h1>
        <p data-guest-inviter hidden></p>
        <p id="guest-invitation-status" data-guest-status role="status"></p>
        <section data-guest-invite hidden>
            <form>
                <label hidden>Your nickname<input data-guest-name></label>
                <button type="submit" data-guest-join>Join game</button>
            </form>
        </section>
        <button data-guest-retry hidden>Try again</button>
    `;
    history.replaceState(null, '', '/beta/game-night/guest#invite=fixture');
    const request = vi.fn()
        .mockResolvedValueOnce(Response.json({ game: 'Royal Flush Chess', host: 'Fixture host', guestName: 'Suggested' }))
        .mockResolvedValueOnce(Response.json({ error: 'That nickname is taken. Choose another.' }, { status: 422 }));
    vi.stubGlobal('fetch', request);
    vi.stubGlobal('localStorage', { getItem: () => null });

    await import('../../r/45662413410ed051/lobby/game-night-guest.js');

    const name = document.querySelector('[data-guest-name]');
    const join = document.querySelector('[data-guest-join]');
    const status = document.querySelector('[data-guest-status]');
    await vi.waitFor(() => expect(name.value).toBe('Suggested'));
    const { attempt } = history.state.gameNightInvite;
    name.value = 'PlayerTwo';
    name.focus();
    name.form.requestSubmit(join);
    name.form.requestSubmit(join);

    await vi.waitFor(() => expect(status.textContent).toBe('That nickname is taken. Choose another.'));
    expect(document.activeElement).toBe(name);
    expect(request.mock.calls.map(([url]) => url)).toEqual([
        '/beta/game-night/invitation/details', '/beta/game-night/invitation/accept'
    ]);
    expect(JSON.parse(request.mock.lastCall[1].body)).toMatchObject({
        code: 'fixture', nick: 'PlayerTwo', attempt, age13: true, passHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
});
