// Explicit browser fixtures exercise review UI without a provider, credentials, or AI network requests.
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

test.skip(({ browserName }) => browserName !== 'chromium', 'Admin fixture coverage uses Chromium.');
const ROOT = '/r/45662413410ed051/';
const aiStatus = (state = 'ready') => ({ enabled: true, mode: 'review-only', state, checked: 5, flagged: 2, failed: 1, skipped: 3, used: 6, limit: 100, pending: 1 });
const snapshot = (changes = {}) => ({
    lock: 'off', lockAuto: false, shield: false, shieldAuto: false, slow: 3,
    budget: { requests: 1, cap: 40000, level: 'normal' },
    reports: [], held: [], users: [], bans: [], rooms: [], lists: { block: [], hold: [], allow: [] }, modlog: [],
    stats: { online: 1, days: {}, byHourOfDayUTC: Array(24).fill(0), kinds: {}, busiestRooms: [], mod: {}, reports: { made: 0, autoHidden: 0, actioned: 0, dismissed: 0 } },
    aiModeration: aiStatus(), aiReviews: [], ...changes
});

async function openFixture(page, baseURL, initial, { personTargetFeature = 1 } = {}) {
    let socket;
    const commands = [];
    const providerRequests = [];
    page.on('request', (request) => { if (new URL(request.url()).hostname === 'api.openai.com') providerRequests.push(request.url()); });
    await page.routeWebSocket((url) => url.pathname.endsWith('/lobby-admin'), (ws) => {
        socket = ws;
        ws.onMessage((raw) => {
            const frame = JSON.parse(String(raw));
            if (frame.t === 'hello') {
                ws.send(JSON.stringify({ t: 'welcome', nick: 'Reviewer', band: true }));
                ws.send(JSON.stringify({ t: 'admin', state: initial }));
            } else commands.push(frame);
        });
        ws.send(JSON.stringify({ t: 'hello', role: 'band', features: personTargetFeature === null ? {} : { personTargets: personTargetFeature } }));
    });
    const relay = hangoutRelayWsBase(baseURL, 'ai-admin-fixture');
    await page.goto(`${ROOT}admin/?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`);
    await page.click('[data-enter]');
    await expect(page.locator('[data-panel]')).toBeVisible();
    return {
        commands, providerRequests,
        publish: (state) => socket.send(JSON.stringify({ t: 'admin', state }))
    };
}

test('AI signals render as evidence and only submit message-id review actions', async ({ page, baseURL }) => {
    const review = { id: 'message-first', from: 'GuestOne', ch: '#night-owls', text: '<img src=x onerror="window.injected=true"> A message for review.', at: 1800000000000, model: '<b>fixture-model</b>', categories: ['harassment', '<svg onload=alert(1)>'] };
    const second = { ...review, id: 'message-second', from: 'GuestTwo', text: 'Another message for review.', categories: ['violence'] };
    const state = snapshot({
        aiReviews: [review, second],
        reports: [{ id: 'report-one', from: 'ReportGuest', ch: '#stalemate', count: 1, text: 'A visitor report.', context: [] }],
        held: [{ id: 'held-one', from: 'HeldGuest', ch: '#stalemate', reason: 'filter', text: 'A held message.' }]
    });
    const fixture = await openFixture(page, baseURL, state);
    await expect(page.locator('[data-qcount]')).toHaveText('(4)');
    expect(await page.locator('[data-reports] button').allTextContents()).toEqual(['Delete', 'Dismiss']);
    const first = page.locator('[data-ai-review-id="message-first"]');
    await expect(first).toContainText(review.text);
    await expect(first).toContainText(review.model);
    await expect(first).toContainText('Signals: harassment, <svg onload=alert(1)>');
    await expect(first.locator('img, svg')).toHaveCount(0);
    expect(await page.evaluate(() => window.injected)).toBeUndefined();
    expect(await first.locator('button').allTextContents()).toEqual(['Delete message', 'Dismiss signal']);
    await first.getByRole('button', { name: 'Delete message', exact: true }).focus();
    fixture.publish({ ...state, aiModeration: { ...aiStatus(), pending: 0 } });
    await expect(page.locator('[data-ai-counts]')).toContainText('Pending 0');
    await expect(first.getByRole('button', { name: 'Delete message', exact: true })).toBeFocused();
    await first.getByRole('button', { name: 'Delete message', exact: true }).click();
    await page.locator('[data-ai-review-id="message-second"]').getByRole('button', { name: 'Dismiss signal', exact: true }).click();
    await expect.poll(() => fixture.commands).toEqual([
        { t: 'cmd', name: 'delete', args: ['message-first'], ch: '#stalemate' },
        { t: 'cmd', name: 'aidismiss', args: ['message-second'], ch: '#stalemate' }
    ]);
    // The server's next snapshot, not an optimistic browser decision, removes review evidence.
    await expect(page.locator('[data-ai-reviews] li')).toHaveCount(2);
    fixture.publish({ ...state, aiReviews: [] });
    await expect(page.locator('[data-ai-reviews] li')).toHaveCount(0);
    await expect(page.locator('[data-ai-state]')).toBeFocused();
    await expect(page.locator('[data-qcount]')).toHaveText('(2)');
    await expect(page.locator('[data-ai-empty]')).toContainText('does not mean every message was checked');
    expect(fixture.providerRequests).toEqual([]);
});

test('AI status explains outages and limits, and old snapshots never imply that AI is active', async ({ page, baseURL }) => {
    const fixture = await openFixture(page, baseURL, snapshot());
    await expect(page.locator('[data-ai-state]')).toHaveText('AI review is ready · review only');
    await expect(page.locator('[data-ai-counts]')).toHaveText('Checked 5 · Flagged 2 · Failed 1 · Skipped 3 · Pending 1 · Usage 6/100');
    fixture.publish(snapshot({ aiModeration: { ...aiStatus(), evidenceStorage: 'degraded' } }));
    await expect(page.locator('[data-moderation-storage]')).toBeVisible();
    await expect(page.locator('[data-moderation-storage]')).toContainText('could not be saved');
    fixture.publish(snapshot());
    await expect(page.locator('[data-moderation-storage]')).toBeHidden();
    fixture.publish(snapshot({ aiModeration: { ...aiStatus(), enabled: false, state: 'not-qualified' } }));
    await expect(page.locator('[data-ai-state]')).toHaveText('AI review is paused · privacy and provider readiness need qualification');
    await expect(page.locator('[data-ai-state]')).toHaveAttribute('data-ai-health', 'not-qualified');
    await expect(page.locator('[data-ai-counts]')).toContainText('Ordinary filters and visitor reports remain available');
    for (const [state, description] of [['degraded', 'interrupted'], ['capped', 'usage limit'], ['misconfigured', 'server configuration']]) {
        fixture.publish(snapshot({ aiModeration: aiStatus(state) }));
        await expect(page.locator('[data-ai-state]')).toContainText(description);
        await expect(page.locator('[data-ai-state]')).toHaveAttribute('data-ai-health', state);
    }
    fixture.publish(snapshot({ aiModeration: { enabled: true, mode: 'review-only', state: 'unexpected' } }));
    await expect(page.locator('[data-ai-state]')).toHaveText('AI review status is unavailable');
    await expect(page.locator('[data-ai-counts]')).toContainText('Checked —');
    fixture.publish(snapshot({ aiModeration: { enabled: false, mode: 'review-only', state: 'disabled' } }));
    await expect(page.locator('[data-ai-state]')).toHaveText('AI review is off');
    await expect(page.locator('[data-ai-counts]')).toContainText('Ordinary filters and visitor reports remain available');
    fixture.publish(snapshot({ aiModeration: { enabled: false, mode: 'review-only', state: 'unavailable' } }));
    await expect(page.locator('[data-ai-state]')).toHaveText('AI review status is unavailable');
    const oldSnapshot = snapshot({ lock: 'readonly', lockAuto: true, shield: true, shieldAuto: true });
    delete oldSnapshot.aiModeration;
    delete oldSnapshot.aiReviews;
    fixture.publish(oldSnapshot);
    await expect(page.locator('[data-ai-state]')).toHaveText('AI review is off');
    await expect(page.locator('[data-state]')).toContainText('automatic safety lock');
    await expect(page.locator('[data-state]')).toContainText('legacy automatic shield');
    await expect(page.locator('[data-state]')).not.toContainText('no band op');
    await expect(page.locator('[data-qcount]')).toHaveText('');
    await expect(page.locator('[data-queue-empty]')).toBeVisible();
    expect(fixture.providerRequests).toEqual([]);
});

test('AI review evidence and actions remain reachable on a phone without horizontal scrolling', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const reviews = Array.from({ length: 4 }, (_, n) => ({ id: `message-${n}`, from: `Guest${n}`, ch: '#night-owls', text: `Long evidence ${'unbroken'.repeat(30)}`, at: 1800000000000, model: 'fixture-model', categories: ['harassment'] }));
    const fixture = await openFixture(page, baseURL, snapshot({ aiReviews: reviews }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    const last = page.locator('[data-ai-review-id="message-3"] button').last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await last.click();
    await expect.poll(() => fixture.commands).toEqual([{ t: 'cmd', name: 'aidismiss', args: ['message-3'], ch: '#stalemate' }]);
    expect(fixture.providerRequests).toEqual([]);
});

test('guests see the conditional AI disclosure and its exclusions before entering', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`${ROOT}lobby/?preview=local-preview-key-0001`);
    const disclosure = page.locator('[data-ai-disclosure]');
    await expect(disclosure).toBeVisible();
    for (const text of ['When AI review is enabled', 'OpenAI', 'PMs', 'invite links', 'invite-only/key-protected/locked rooms', 'cameras', 'encrypted private rooms', '24 hours']) await expect(disclosure).toContainText(text);
    await page.goto(`${ROOT}terms/`);
    await expect(page.getByRole('heading', { name: 'How AI review works' })).toBeVisible();
    await expect(page.locator('.terms')).toContainText('not a public chat archive');
    await page.mouse.wheel(0, 10000);
    await expect(page.getByRole('link', { name: 'Back to #stalemate', exact: true })).toBeInViewport();
});

test('community moderators see review actions without band configuration controls', async ({ page, baseURL }) => {
    await openFixture(page, baseURL, snapshot({ capabilities: { moderate: true, configure: false }, users: [{ nick: 'Helper', role: 'moderator', channels: ['#stalemate'] }] }));
    await expect(page.locator('[data-panic]')).toBeHidden();
    await expect(page.locator('[data-tab="filter"]')).toBeHidden();
    await expect(page.locator('[data-lobby="unlock"]')).toBeHidden();
    await page.click('[data-tab="people"]');
    await expect(page.locator('[data-users]')).toContainText('MOD Helper');
    await expect(page.locator('[data-users]')).not.toContainText('⭐ Helper');
    await page.click('[data-tab="queue"]');
    await expect(page.locator('[data-ai-state]')).toBeVisible();
});


test('selected admin people and individual ban rules use exact identities and the original room instance', async ({ page, baseURL }) => {
    const nonce = 'a'.repeat(32), firstMask = 'dev:ExactCaseOriginal', secondMask = 'dev:ExactCaseOther';
    const state = snapshot({ users: [{ id: 'original-connection', nick: 'Original', role: 'fan', channels: ['#stalemate'] }],
        rooms: [{ name: '#stalemate', kind: 'lobby', keepRef: nonce, modes: {} }],
        bans: [{ mask: firstMask, nick: 'EarlierOriginal', by: 'Reviewer', at: 1800000000000, reason: 'First exact restriction' },
            { mask: secondMask, nick: 'OtherVisitor', by: 'Reviewer', at: 1800000000000, reason: 'Independent restriction' }] });
    const fixture = await openFixture(page, baseURL, state);
    await page.click('[data-tab="people"]');
    const originalRow = page.locator('[data-users] > li').filter({ hasText: /^Original/ });
    // A native reason prompt holds this selected row's action while a new
    // roster snapshot is queued. The endpoint must remain the original ID.
    page.once('dialog', async dialog => {
        fixture.publish({ ...state, users: [
            { id: 'original-connection', nick: 'RenamedOriginal', role: 'fan', channels: ['#stalemate'] },
            { id: 'replacement-connection', nick: 'Original', role: 'fan', channels: ['#stalemate'] }
        ] });
        await dialog.accept('A reason for the selected original connection');
    });
    await originalRow.getByRole('button', { name: 'Ban', exact: true }).click();
    await expect.poll(() => fixture.commands.length).toBe(1);
    expect(fixture.commands[0]).toMatchObject({ t: 'cmd', name: 'gban', ch: '#stalemate', roomInstance: nonce, personContext: 1, personPeer: 'original-connection' });
    expect(fixture.commands[0]).not.toHaveProperty('personNamed');
    await expect(page.locator('[data-users]')).toContainText('RenamedOriginal');
    await page.locator('[data-users] > li').filter({ hasText: /^RenamedOriginal/ }).getByRole('button', { name: 'Purge lines', exact: true }).click();
    await expect.poll(() => fixture.commands.length).toBe(2);
    expect(fixture.commands[1]).toMatchObject({ name: 'purge', personPeer: 'original-connection', roomInstance: nonce });
    expect(await page.locator('[data-bans] > li').count()).toBe(2);
    await page.locator('[data-bans] > li').filter({ hasText: 'EarlierOriginal' }).getByRole('button', { name: 'Unban this rule', exact: true }).click();
    await expect.poll(() => fixture.commands.length).toBe(3);
    expect(fixture.commands[2]).toEqual({ t: 'cmd', name: 'unban', args: [firstMask], ch: '#stalemate', roomInstance: nonce });
    expect(fixture.commands[2]).not.toHaveProperty('personPeer');
    await expect(page.locator('[data-bans]')).toContainText('OtherVisitor');
    // Rule masks are staff-only action values, not public nickname identity or
    // newly displayed device/account identifiers.
    await expect(page.locator('[data-bans]')).not.toContainText(firstMask);
    expect(fixture.providerRequests).toEqual([]);
});

test('older admin capabilities disable ambiguous person controls while exact evidence actions stay usable', async ({ page, baseURL }) => {
    const state = snapshot({ users: [{ id: 'original-connection', nick: 'Original', role: 'fan', channels: ['#stalemate'] }],
        rooms: [{ name: '#stalemate', kind: 'lobby', keepRef: 'a'.repeat(32), modes: {} }],
        reports: [{ id: 'exact-message', from: 'HistoricalName', ch: '#stalemate', count: 1, text: 'Retained exact evidence', context: [] }],
        bans: [{ mask: 'dev:StoredExactRule', nick: 'HistoricalName', by: 'Reviewer', at: 1800000000000, reason: 'Stored rule' }] });
    const fixture = await openFixture(page, baseURL, state, { personTargetFeature: '1' });
    await page.click('[data-tab="people"]');
    for (const label of ['Mute 10m', 'Mute 24h', 'Kick', 'Ban', 'Purge lines'])
        await expect(page.locator('[data-users]').getByRole('button', { name: label, exact: true })).toBeDisabled();
    await expect(page.locator('[data-bans]').getByRole('button', { name: 'Unban this rule', exact: true })).toBeDisabled();
    await page.click('[data-tab="queue"]');
    await page.locator('[data-reports]').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(() => fixture.commands).toEqual([{ t: 'cmd', name: 'delete', args: ['exact-message'], ch: '#stalemate' }]);
});
