// Controlled staff WebSocket snapshots exercise UI only, not Access or durability.
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');

const ROOT = '/r/45662413410ed051/';
const FIRST = 'pr' + 'A'.repeat(43);
const SECOND = 'pr' + 'B'.repeat(43);
const report = (extra = {}) => ({ id: FIRST, at: 1800000000000, kind: 'message', claimedName: 'ClaimedGuest',
    excerpt: 'A deliberately shared private quote', reason: 'A reporter-selected explanation',
    roomRef: 'R'.repeat(43), reporterConnection: 'pReporter', targetConnection: 'pClaimed',
    targetMembership: 'live', quoteVerified: false, ...extra });
const snapshot = (extra = {}) => ({
    lock: 'off', lockAuto: false, shield: false, shieldAuto: false, slow: 3,
    capabilities: { moderate: true, configure: false },
    budget: { requests: 1, cap: 40000, level: 'normal' },
    reports: [], held: [], users: [], bans: [], rooms: [], lists: { block: [], hold: [], allow: [] }, modlog: [],
    stats: { online: 1, days: {}, byHourOfDayUTC: Array(24).fill(0), kinds: {}, busiestRooms: [], mod: {}, reports: { made: 0, autoHidden: 0, actioned: 0, dismissed: 0 } },
    aiModeration: { enabled: false, state: 'disabled' }, aiReviews: [], ...extra
});
const privateQueue = (reports = [report()], storage = 'ready') => ({ storage, reports });

test.skip(({ browserName }) => browserName !== 'chromium', 'Private staff UI protocol fixture uses Chromium.');
test.afterEach(async ({ page }) => { expect(page.staffFixtureErrors || []).toEqual([]); });

async function openFixture(page, baseURL, initial) {
    let socket;
    const commands = [], providerRequests = [], sockets = [];
    page.staffFixtureErrors = [];
    page.on('pageerror', error => page.staffFixtureErrors.push(error.message));
    page.on('request', request => {
        if (new URL(request.url()).hostname === 'api.openai.com') providerRequests.push(request.url());
    });
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin
        ? route.continue() : route.abort());
    await page.routeWebSocket(url => url.pathname.endsWith('/lobby-admin'), ws => {
        socket = ws;
        sockets.push(ws);
        const initialState = typeof initial === 'function' ? initial(sockets.length) : initial;
        ws.onMessage(raw => {
            const frame = JSON.parse(String(raw));
            if (frame.t === 'hello') {
                ws.send(JSON.stringify({ t: 'welcome', nick: 'FixtureReviewer', band: false, moderator: true }));
                ws.send(JSON.stringify({ t: 'admin', state: initialState }));
            } else commands.push(frame);
        });
        ws.send(JSON.stringify({ t: 'hello', role: 'moderator' }));
    });
    const relay = hangoutRelayWsBase(baseURL, 'private-admin-fixture');
    await page.goto(`${ROOT}admin/?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`);
    await page.click('[data-enter]');
    await expect(page.locator('[data-panel]')).toBeVisible();
    return { commands, providerRequests,
        socketCount: () => sockets.length,
        close: (index, code = 4401) => sockets[index].close({ code, reason: 'owned staff-session fixture ended' }),
        publish: state => socket.send(JSON.stringify({ t: 'admin', state })) };
}

test('private evidence is safely rendered as an unverified claim and counted with the other queues', async ({ page, baseURL }) => {
    const first = report({ claimedName: '<b>Alias</b>', excerpt: '<img src=x onerror="window.injected=true">\nA selected quote.',
        reason: '<svg onload="window.injected=true"> A reason.' });
    const second = report({ id: SECOND, kind: 'member', claimedName: 'FormerGuest', excerpt: '',
        targetMembership: 'unverified', targetConnection: null });
    const state = snapshot({ privateReports: privateQueue([first, second]),
        reports: [{ id: 'mpublic', from: 'PublicGuest', ch: '#stalemate', count: 1, text: 'A public report', context: [] }],
        held: [{ id: 'mheld', from: 'HeldGuest', ch: '#stalemate', reason: 'filter', text: 'A held line' }],
        aiReviews: [{ id: 'mai', from: 'AiGuest', ch: '#stalemate', text: 'An earlier AI signal', model: 'fixture', categories: ['harassment'] }] });
    const fixture = await openFixture(page, baseURL, state);
    const section = page.locator('[data-private-report-review]');
    await expect(section).toBeVisible();
    await expect(page.locator('[data-qcount]')).toHaveText('(5)');
    const row = page.locator(`[data-private-report-id="${FIRST}"]`);
    await expect(row).toContainText(first.claimedName);
    await expect(row.locator('pre')).toHaveText(first.excerpt);
    await expect(row).toContainText(first.reason);
    await expect(row).toContainText('quote not independently verified');
    await expect(row).toContainText('does not verify the quote or nickname');
    await expect(section.locator('img, svg, iframe')).toHaveCount(0);
    expect(await page.evaluate(() => window.injected)).toBeUndefined();
    expect(await row.locator('button').allTextContents()).toEqual(['Resolve report', 'Dismiss report']);
    await expect(section.getByRole('button', { name: /Delete|Mute|Ban|Kick|Camera/i })).toHaveCount(0);
    await expect(section).toContainText('does not delete private chat or punish a participant');
    await expect(page.locator(`[data-private-report-id="${SECOND}"]`)).toContainText('absent or unverified');
    await expect(page.locator(`[data-private-report-id="${SECOND}"]`)).toContainText('Do not identify or punish someone by the retained nickname');
    expect(fixture.providerRequests).toEqual([]);
});

test('Resolve and Dismiss send only exact private report commands and wait for server removal', async ({ page, baseURL }) => {
    const state = snapshot({ privateReports: privateQueue([report(), report({ id: SECOND, kind: 'member', excerpt: '' })]) });
    const fixture = await openFixture(page, baseURL, state);
    await page.locator(`[data-private-report-id="${FIRST}"]`).getByRole('button', { name: 'Resolve report', exact: true }).click();
    await page.locator(`[data-private-report-id="${SECOND}"]`).getByRole('button', { name: 'Dismiss report', exact: true }).click();
    await expect.poll(() => fixture.commands).toEqual([
        { t: 'cmd', name: 'privatereport', args: ['resolve', FIRST], ch: '#stalemate' },
        { t: 'cmd', name: 'privatereport', args: ['dismiss', SECOND], ch: '#stalemate' }
    ]);
    await expect(page.locator('[data-private-reports] li')).toHaveCount(2);
    await expect(page.locator('[data-qcount]')).toHaveText('(2)');
    fixture.publish(snapshot({ privateReports: privateQueue([]) }));
    await expect(page.locator('[data-private-reports] li')).toHaveCount(0);
    await expect(page.locator('[data-qcount]')).toHaveText('');
    await expect(page.locator('[data-queue-empty]')).toBeVisible();
});

test('a ready redraw preserves the focused report action and removal moves focus to status', async ({ page, baseURL }) => {
    const first = report(), second = report({ id: SECOND });
    const fixture = await openFixture(page, baseURL, snapshot({ privateReports: privateQueue([first, second]) }));
    const action = page.locator(`[data-private-report-id="${FIRST}"]`).getByRole('button', { name: 'Dismiss report', exact: true });
    await action.focus();
    fixture.publish(snapshot({ privateReports: privateQueue([second, { ...first, reason: 'Additional explicit report reason' }]) }));
    await expect(page.locator(`[data-private-report-id="${FIRST}"]`)).toContainText('Additional explicit report reason');
    await expect(action).toBeFocused();
    fixture.publish(snapshot({ privateReports: privateQueue([second]) }));
    await expect(page.locator(`[data-private-report-id="${FIRST}"]`)).toHaveCount(0);
    await expect(page.locator('[data-private-report-storage]')).toBeFocused();
});

test('storage becoming unavailable disables review actions and leaves keyboard focus on the explanation', async ({ page, baseURL }) => {
    const fixture = await openFixture(page, baseURL, snapshot({ privateReports: privateQueue() }));
    await page.locator('[data-private-reports]').getByRole('button', { name: 'Resolve report', exact: true }).focus();
    fixture.publish(snapshot({ privateReports: privateQueue([report()], 'unavailable') }));
    await expect(page.locator('[data-private-report-storage]')).toContainText('unavailable');
    await expect(page.locator('[data-private-reports]').getByRole('button', { name: 'Resolve report', exact: true })).toBeDisabled();
    await expect(page.locator('[data-private-reports]').getByRole('button', { name: 'Dismiss report', exact: true })).toBeDisabled();
    await expect(page.locator('[data-private-report-storage]')).toBeFocused();
    expect(fixture.commands).toEqual([]);
    fixture.publish(snapshot({ privateReports: privateQueue() }));
    await expect(page.locator('[data-private-reports]').getByRole('button', { name: 'Resolve report', exact: true })).toBeEnabled();
});

test('an older server snapshot without privateReports keeps the private section hidden', async ({ page, baseURL }) => {
    const fixture = await openFixture(page, baseURL, snapshot());
    await expect(page.locator('[data-private-report-review]')).toBeHidden();
    await expect(page.locator('[data-qcount]')).toHaveText('');
    fixture.publish(snapshot({ privateReports: privateQueue() }));
    await expect(page.locator('[data-private-report-review]')).toBeVisible();
    await expect(page.locator('[data-qcount]')).toHaveText('(1)');
    fixture.publish(snapshot());
    await expect(page.locator('[data-private-report-review]')).toBeHidden();
    await expect(page.locator('[data-qcount]')).toHaveText('');
    await expect(page.locator('[data-queue-empty]')).toBeVisible();
    expect(fixture.commands).toEqual([]);
    expect(fixture.providerRequests).toEqual([]);
});

test('current staff socket close4401 clears private evidence and state and disables the review panel', async ({ page, baseURL }) => {
    const evidence = report();
    const fixture = await openFixture(page, baseURL, snapshot({ privateReports: privateQueue([evidence]) }));
    await expect(page.locator('[data-private-reports]')).toContainText(evidence.excerpt);
    await page.evaluate(() => { window.__closingStaffSocket = window.__admin.ws; });
    await fixture.close(0, 4401);
    await expect.poll(() => page.evaluate(() => window.__closingStaffSocket.readyState)).toBe(3);
    // Snapshot the real callback's completed UI result, including hidden DOM.
    // Removing a panel visually must not leave its private text in the page.
    const ended = await page.evaluate(({ excerpt, reason }) => ({
        stateCleared: window.__admin.state === null,
        panelHidden: document.querySelector('[data-panel]').hidden,
        gateVisible: !document.querySelector('[data-gate]').hidden,
        privateRows: document.querySelector('[data-private-reports]').children.length,
        quoteAbsent: !document.body.textContent.includes(excerpt),
        reasonAbsent: !document.body.textContent.includes(reason),
        enabledPrivateActions: document.querySelectorAll('[data-private-report-action]:enabled').length
    }), evidence);
    expect(ended).toEqual({ stateCleared: true, panelHidden: true, gateVisible: true,
        privateRows: 0, quoteAbsent: true, reasonAbsent: true, enabledPrivateActions: 0 });
    expect(fixture.commands).toEqual([]);
});

test('retired staff callbacks cannot repopulate evidence or clear a replacement staff connection', async ({ page, baseURL }) => {
    const previous = snapshot({ privateReports: privateQueue() });
    const nextReport = report({ id: SECOND, excerpt: 'Replacement staff session selected evidence', reason: 'Replacement staff session reason' });
    const current = snapshot({ privateReports: privateQueue([nextReport]) });
    const fixture = await openFixture(page, baseURL, generation => generation === 1 ? previous : current);
    await page.evaluate(() => {
        const socket = window.__admin.ws;
        window.__retiredStaffCallbacks = { socket, message: socket.onmessage, close: socket.onclose };
    });
    await fixture.close(0, 4401);
    await expect.poll(() => page.evaluate(() => window.__retiredStaffCallbacks.socket.readyState)).toBe(3);
    // Invoke the actual Enter handler rather than replacing application state or
    // constructing a fake staff identity. The socket/Access are protocol mocks.
    await page.locator('[data-enter]').evaluate(button => button.click());
    await expect.poll(() => fixture.socketCount()).toBe(2);
    await expect(page.locator(`[data-private-report-id="${SECOND}"]`)).toContainText(nextReport.excerpt);
    await expect(page.locator('[data-panel]')).toBeVisible();
    await page.evaluate(() => { window.__replacementStaffSocket = window.__admin.ws; });
    const afterMessage = await page.evaluate(async previous => {
        const retired = window.__retiredStaffCallbacks;
        await retired.message.call(retired.socket, new MessageEvent('message', { data: JSON.stringify({ t: 'admin', state: previous }) }));
        return { id: window.__admin.state?.privateReports?.reports?.[0]?.id || null,
            currentSocketRetained: window.__admin.ws === window.__replacementStaffSocket,
            panelVisible: !document.querySelector('[data-panel]').hidden,
            text: document.querySelector('[data-private-reports]').textContent };
    }, previous);
    // Restore via a genuine current-socket fixture frame before testing the old
    // close callback independently; a failed old-message fence must not conceal
    // a second, distinct cleanup-on-the-wrong-connection bug.
    fixture.publish(current);
    await expect(page.locator(`[data-private-report-id="${SECOND}"]`)).toContainText(nextReport.excerpt);
    const afterClose = await page.evaluate(async () => {
        const retired = window.__retiredStaffCallbacks;
        await retired.close.call(retired.socket, new CloseEvent('close', { code: 4401, reason: 'obsolete callback fixture' }));
        return { id: window.__admin.state?.privateReports?.reports?.[0]?.id || null,
            currentSocketRetained: window.__admin.ws === window.__replacementStaffSocket,
            panelVisible: !document.querySelector('[data-panel]').hidden,
            text: document.querySelector('[data-private-reports]').textContent };
    });
    for (const result of [afterMessage, afterClose]) {
        expect(result.id).toBe(SECOND);
        expect(result.currentSocketRetained).toBe(true);
        expect(result.panelVisible).toBe(true);
        expect(result.text).toContain(nextReport.excerpt);
        expect(result.text).not.toContain(report().excerpt);
    }
    expect(fixture.commands).toEqual([]);
});
