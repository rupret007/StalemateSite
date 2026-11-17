// Actual keyboard events and local WebSockets. Responsive viewport checks are
// zoom/reflow equivalents, not native browser zoom, screen-reader speech or iOS.
const { randomUUID } = require('node:crypto');
const { writeFile } = require('node:fs/promises');
const { setTimeout: delay } = require('node:timers/promises');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');
const ROOT = '/r/45662413410ed051/lobby/';

// Safari's default keyboard navigation skips buttons with plain Tab. Exercise
// its documented Option-Tab path on macOS, without changing user preferences.
// Linux/Windows and Chromium retain their ordinary Tab sequence.
function tabKey(page, reverse = false) {
    const option = process.platform === 'darwin' && page.context().browser()?.browserType().name() === 'webkit';
    return `${option ? 'Alt+' : ''}${reverse ? 'Shift+' : ''}Tab`;
}
async function tabTo(page, target) {
    await expect(target).toBeVisible();
    for (let i = 0; i < 90; i += 1) {
        if (await target.evaluate(element => element === document.activeElement)) return;
        await page.keyboard.press(tabKey(page));
    }
    throw new Error('Visible control was not reachable through the actual Tab sequence');
}
async function replaceText(page, value) {
    await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type(value);
}
async function guest(browser, baseURL, nickname, viewport, relayOverride, preparePage) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/youtube\.com|ytimg|googlevideo|goatcounter/, route => route.abort());
    if (preparePage) await preparePage(page);
    const relay = relayOverride || hangoutRelayWsBase(baseURL, `accessibility-${randomUUID()}`);
    await page.goto(`${ROOT}?preview=local-preview-key-0001&via=rad-dad&relay=${encodeURIComponent(relay)}`);
    await tabTo(page, page.getByRole('textbox', { name: 'Your nick', exact: true }));
    await page.keyboard.type(nickname);
    await expect(page.locator('[data-enter]')).toBeEnabled();
    await tabTo(page, page.locator('[data-enter]')); await page.keyboard.press('Space');
    await expect(page.locator('[data-connection]')).toHaveText('Connected');
    return { page, errors, close: () => context.close() };
}
async function send(page, value) {
    await tabTo(page, page.getByRole('textbox', { name: 'Message', exact: true }));
    await replaceText(page, value); await page.keyboard.press('Enter');
}
async function section(page, name) {
    const navigation = page.locator(`nav [data-show="${name}"]`);
    if (await navigation.isVisible()) { await tabTo(page, navigation); await page.keyboard.press('Enter'); }
}
async function composerGeometry(page) {
    return page.evaluate(() => {
        const form = document.querySelector('[data-say]'), input = document.querySelector('[data-text]'), button = document.querySelector('[data-send]');
        const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
        const hit = element => { const r = element.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); };
        const uncovered = element => {
            const r = element.getBoundingClientRect(), inset = 4;
            return [[r.left + inset, r.top + inset], [r.right - inset, r.top + inset],
                [r.left + inset, r.bottom - inset], [r.right - inset, r.bottom - inset],
                [r.left + r.width / 2, r.top + r.height / 2]]
                .every(([x, y]) => element.contains(document.elementFromPoint(x, y)));
        };
        return { viewport: { width: innerWidth, height: innerHeight }, pageWidth: document.documentElement.scrollWidth, chat: rect(document.querySelector('[data-pane="chat"]')),
            form: rect(form), input: rect(input), send: rect(button), inputUncovered: uncovered(input), sendUncovered: uncovered(button),
            inputHit: hit(input)?.outerHTML.slice(0, 400), sendHit: hit(button)?.outerHTML.slice(0, 400),
            fontSize: getComputedStyle(input).fontSize,
            textWidths: ['[data-buffer]', '[data-topic]'].map(selector => { const element = document.querySelector(selector), style = getComputedStyle(element); return { selector, scroll: element.scrollWidth, client: element.clientWidth, height: element.clientHeight,
                lineHeight: parseFloat(style.lineHeight), verticalPadding: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) }; }) };
    });
}
async function attachGeometry(testInfo, name, geometry) {
    const path = testInfo.outputPath(`${name}.json`);
    await writeFile(path, JSON.stringify(geometry, null, 2));
    await testInfo.attach(name, { path, contentType: 'application/json' });
}
function contained(geometry) {
    expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewport.width);
    for (const item of [geometry.form, geometry.input, geometry.send]) {
        expect(item.width).toBeGreaterThan(0); expect(item.height).toBeGreaterThan(0);
        expect(item.left).toBeGreaterThanOrEqual(0); expect(item.right).toBeLessThanOrEqual(geometry.viewport.width);
        expect(item.top).toBeGreaterThanOrEqual(0); expect(item.bottom).toBeLessThanOrEqual(geometry.viewport.height);
    }
    expect(geometry.form.top).toBeGreaterThanOrEqual(geometry.chat.top); expect(geometry.form.bottom).toBeLessThanOrEqual(geometry.chat.bottom);
    expect(geometry.inputUncovered).toBe(true); expect(geometry.sendUncovered).toBe(true);
    for (const text of geometry.textWidths) expect(text.scroll).toBeLessThanOrEqual(text.client);
    const log = geometry.textWidths.find(text => text.selector === '[data-buffer]');
    expect(log.height).toBeGreaterThanOrEqual(log.lineHeight + log.verticalPadding);
}

for (const width of [375, 1440]) test(`landmarks, visible nickname label and message-list semantics at ${width}px`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    try {
        const page = await context.newPage();
        await page.route(/youtube\.com|ytimg|googlevideo|goatcounter/, route => route.abort());
        const relay = hangoutRelayWsBase(baseURL, `semantics-${randomUUID()}`);
        await page.goto(`${ROOT}?preview=local-preview-key-0001&relay=${encodeURIComponent(relay)}`);
        await expect(page.getByRole('main')).toHaveCount(1);
        await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('#stalemate');
        await expect(page.getByRole('group', { name: 'Ways to hang out' })).toContainText('Anyone can host');
        const nickname = page.getByRole('textbox', { name: 'Your nick', exact: true });
        const nicknameLabel = page.locator('label').filter({ hasText: /^Your nick$/ });
        await expect(nicknameLabel).toBeVisible();
        await expect(nicknameLabel.locator('button')).toHaveCount(0);
        await nicknameLabel.click();
        await expect(nickname).toBeFocused();
        await page.screenshot({ path: testInfo.outputPath(`nickname-label-focused-${width}.png`) });
        const randomName = page.getByRole('button', { name: /^Make me a name/ });
        await expect(randomName).toBeVisible();
        await randomName.click(); await expect(nickname).not.toHaveValue('');
        await nickname.fill(`SemanticGuest${width}`); await page.locator('[data-enter]').click();
        await expect(page.locator('[data-connection]')).toHaveText('Connected');
        await expect(page.getByRole('main')).toHaveCount(1);
        await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Community chat');
        const quick = page.locator('[data-quick]');
        await expect(quick.getByRole('button', { name: 'Send 🤘 SHRED', exact: true })).toBeVisible();
        await expect(quick.getByRole('button', { name: 'Send happy little tree 🌲', exact: true })).toBeVisible();
        await send(page, 'A message in the accessible conversation');
        const conversation = page.getByRole('log', { name: 'Conversation' });
        await expect(conversation.getByRole('list', { name: 'Messages' })).toContainText('A message in the accessible conversation');
        await expect(conversation.getByRole('listitem').filter({ hasText: 'A message in the accessible conversation' })).toHaveCount(1);
    } finally { await context.close(); }
});

for (const [width, height] of [[390, 844], [1440, 900]]) test(`the connection status keeps keyboard focus through manual retry at ${width}px`, async ({ browser, baseURL }, testInfo) => {
    let firstSocket, releaseFrames;
    const visitor = await guest(browser, baseURL, 'RetryFocusGuest', { width, height }, undefined, async page => {
        await page.routeWebSocket(/\/sessions\/accessibility-/, socket => {
            const server = socket.connectToServer();
            if (!firstSocket) { firstSocket = socket; return; }
            const pending = [];
            let released = false;
            releaseFrames = () => {
                released = true;
                for (const message of pending.splice(0)) socket.send(message);
            };
            server.onMessage(message => {
                if (released) socket.send(message);
                else pending.push(message);
            });
        });
    });
    const { page } = visitor;
    const status = page.locator('[data-connection]');
    const retry = page.getByRole('button', { name: 'Try again', exact: true });
    try {
        firstSocket.close({ code: 4400, reason: 'Fixture retry' });
        await expect(status).toHaveText('Offline');
        await tabTo(page, retry);
        await page.screenshot({ path: testInfo.outputPath(`retry-focus-offline-${width}.png`) });

        await page.keyboard.press('Enter');
        await expect(retry).toBeHidden();
        await expect(status).toHaveText('Reconnecting…');
        await expect(status).toBeFocused();
        await expect(status).toBeInViewport();
        await page.screenshot({ path: testInfo.outputPath(`retry-focus-connecting-${width}.png`) });
        await expect.poll(() => Boolean(releaseFrames)).toBe(true);
        releaseFrames();

        await expect(status).toHaveText('Connected');
        await expect(status).toBeFocused();
        await send(page, 'Keyboard chat after reconnect');
        await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('Keyboard chat after reconnect');
        await page.screenshot({ path: testInfo.outputPath(`retry-focus-recovered-${width}.png`) });
        expect(visitor.errors).toEqual([]);
    } finally { await visitor.close(); }
});

for (const [width, height] of [[390, 844], [1440, 900]]) test(`keyboard new-message jump keeps the conversation readable at ${width}px`, async ({ browser, baseURL }, testInfo) => {
    let guestSocket;
    const visitor = await guest(browser, baseURL, 'ScrollbackGuest', { width, height }, undefined, async page => {
        await page.routeWebSocket(/\/sessions\/accessibility-/, socket => {
            guestSocket = socket;
            socket.connectToServer();
        });
    });
    const { page } = visitor;
    const conversation = page.getByRole('log', { name: 'Conversation' });
    const line = (text) => guestSocket.send(JSON.stringify({ t: 'line', ch: '#stalemate', from: 'FixtureGuest', text }));
    const scrollTop = () => conversation.evaluate(element => element.scrollTop);
    try {
        await expect(conversation).toBeVisible();
        await tabTo(page, conversation);
        for (let i = 1; i <= 40; i += 1) line(`Scrollback line ${i}. Earlier chat stays readable while new messages arrive in this session.`);
        await expect(conversation).toContainText('Scrollback line 40.');
        await expect.poll(scrollTop).toBeGreaterThan(100);
        await page.keyboard.press('Home');
        await expect.poll(scrollTop).toBe(0);

        line('Fresh message below the fold');
        const jump = page.getByRole('button', { name: '1 new message ↓' });
        await expect(jump).toBeVisible();
        await expect(conversation).toBeFocused();
        await page.keyboard.press(tabKey(page));
        await expect(jump).toBeFocused();
        await expect(jump).toBeInViewport();
        await page.screenshot({ path: testInfo.outputPath(`scrollback-before-jump-${width}.png`) });

        await page.keyboard.press('Enter');
        await expect(jump).toBeHidden();
        await expect(conversation).toBeFocused();
        await expect(conversation).toBeInViewport();
        await expect(conversation.getByText('Fresh message below the fold')).toBeInViewport();
        await page.screenshot({ path: testInfo.outputPath(`scrollback-after-jump-${width}.png`) });
        const bottom = await scrollTop();
        await page.keyboard.press('PageUp');
        await expect.poll(scrollTop).toBeLessThan(bottom);
        expect(visitor.errors).toEqual([]);
    } finally { await visitor.close(); }
});

for (const width of [375, 390]) test(`mobile keyboard section shortcuts focus the opened pane at ${width}px`, async ({ browser, baseURL }, testInfo) => {
    const visitor = await guest(browser, baseURL, `SectionFocus${width}`, { width, height: 667 });
    const { page } = visitor;
    try {
        const start = page.getByRole('button', { name: /Start a room/ });
        await tabTo(page, start);
        await page.keyboard.press('Enter');
        const startHeading = page.getByRole('heading', { name: 'Make room for something' });
        await expect(startHeading).toBeFocused();
        await expect(startHeading).toBeInViewport();
        await page.keyboard.press(tabKey(page));
        await expect(page.getByRole('button', { name: /Start a chat channel/ })).toBeFocused();
        await page.screenshot({ path: testInfo.outputPath(`mobile-section-focus-${width}.png`) });

        await section(page, 'people');
        await expect(page.locator('[data-people-title]')).toBeFocused();
        await expect(page.locator('nav [data-show="people"]')).toHaveAttribute('aria-current', 'true');
        await section(page, 'chat');
        await expect(page.getByRole('tab', { name: '#stalemate' })).toBeFocused();
        await section(page, 'rooms');
        await expect(page.getByRole('heading', { name: /^Room directory/ })).toBeFocused();
        await expect(page.locator('nav [data-show="rooms"]')).toHaveAttribute('aria-current', 'true');
        expect(visitor.errors).toEqual([]);
    } finally { await visitor.close(); }
});

for (const [width, height] of [[390, 844], [1440, 900]]) test(`a named channel request can be retried after reconnect at ${width}px`, async ({ browser, baseURL }, testInfo) => {
    const room = '#retry-channel';
    let requests = 0, dropConnection;
    const visitor = await guest(browser, baseURL, 'ChannelRetryGuest', { width, height }, undefined, async page => {
        await page.routeWebSocket(/\/sessions\/accessibility-/, socket => {
            const server = socket.connectToServer();
            socket.onMessage(message => {
                const frame = JSON.parse(String(message));
                if (frame.t === 'cmd' && frame.name === 'join' && frame.args?.[0] === room) {
                    requests += 1;
                    if (requests === 1) {
                        dropConnection = () => socket.close({ code: 4402, reason: 'Fixture interrupted channel request' });
                        return;
                    }
                }
                server.send(message);
            });
        });
    });
    const { page } = visitor;
    try {
        await section(page, 'rooms');
        await tabTo(page, page.locator('[data-start="chat"]'));
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', { name: 'Your own #channel', exact: true });
        const name = dialog.getByRole('textbox', { name: 'Channel name' });
        await expect(name).toBeFocused();
        await page.keyboard.type(room);
        await page.screenshot({ path: testInfo.outputPath(`named-channel-before-reconnect-${width}.png`) });
        await page.keyboard.press('Enter');

        await expect(dialog.getByRole('status')).toHaveText(
            'Still waiting for confirmation. You can try Join / create again or choose Cancel.', { timeout: 12000 });
        expect(requests).toBe(1);
        await expect(name).toBeFocused();
        await page.screenshot({ path: testInfo.outputPath(`named-channel-no-confirmation-${width}.png`) });
        await dropConnection();

        await expect(dialog.getByRole('status')).toHaveText('Connected again. Choose Join / create to try this name again.');
        await expect(name).toHaveValue(room);
        await expect(name).toBeFocused();
        expect(requests).toBe(1);
        await page.screenshot({ path: testInfo.outputPath(`named-channel-ready-to-retry-${width}.png`) });

        await page.keyboard.press('Enter');
        await expect(dialog).toBeHidden();
        await expect(page.locator('[data-chat-context]')).toHaveText(room);
        expect(requests).toBe(2);
        await send(page, 'First message in the recovered channel');
        await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('First message in the recovered channel');
        await page.screenshot({ path: testInfo.outputPath(`named-channel-after-reconnect-${width}.png`) });
        expect(visitor.errors).toEqual([]);
    } finally { await visitor.close(); }
});

test('keyboard guest can join, recover a named-room error, chat, navigate tabs and leave host dialogs', async ({ browser, baseURL }, testInfo) => {
    const visitor = await guest(browser, baseURL, 'KeyboardVisitor', { width: 1280, height: 900 });
    const { page } = visitor;
    try {
        const opener = page.locator('[data-start="chat"]');
        await tabTo(page, opener); await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', { name: 'Your own #channel', exact: true });
        await expect(dialog).toBeVisible(); await expect(page.locator('[data-channel-name]')).toBeFocused();
        await page.keyboard.type('#art-keyboard'); await page.keyboard.press('Enter');
        await expect(page.locator('[data-channel-error]')).toContainText('starts an activity room');
        await expect(page.locator('[data-channel-name]')).toHaveAttribute('aria-describedby', /channel-name-error/);
        await expect(page.locator('[data-channel-name]')).toBeFocused();
        await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(opener).toBeFocused();
        await page.keyboard.press('Enter'); await replaceText(page, '#keyboard-studio'); await page.keyboard.press('Enter');
        await expect(page.locator('[data-chat-context]')).toHaveText('#keyboard-studio');
        await expect(dialog).toBeHidden();
        await send(page, 'A real message sent using only the keyboard');
        await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('A real message sent using only the keyboard');
        const active = page.locator('[role="tab"][aria-selected="true"]');
        await tabTo(page, active); await page.keyboard.press('Home');
        await expect(page.locator('[data-channel-key="#stalemate"]')).toBeFocused();
        await page.keyboard.press('End'); await expect(page.locator('[data-channel-key="#keyboard-studio"]')).toBeFocused();
        await expect(page.locator('[data-buffer]')).toContainText('A real message sent using only the keyboard');
        await tabTo(page, page.locator('[data-roomtools]')); await page.keyboard.press('Enter');
        const palette = page.locator('dialog[data-palette]'); await expect(palette).toBeVisible();
        expect(await palette.evaluate(element => element.contains(document.activeElement))).toBe(true);
        await page.keyboard.press('Escape'); await expect(palette).toBeHidden(); await expect(page.locator('[data-roomtools]')).toBeFocused();
        const outline = await page.locator('[data-roomtools]').evaluate(element => ({ width: getComputedStyle(element).outlineWidth, style: getComputedStyle(element).outlineStyle }));
        expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2); expect(outline.style).not.toBe('none');
        await page.screenshot({ path: testInfo.outputPath('keyboard-room-focus.png'), fullPage: true });
        expect(visitor.errors).toEqual([]);
    } finally { await visitor.close(); }
});

for (const width of [390, 1280]) test(`leaving Paint along with the keyboard returns focus to the lobby at ${width}px`, async ({ browser, baseURL }) => {
    const visitor = await guest(browser, baseURL, `PaintFocus${width}`, { width, height: 844 });
    const { page } = visitor;
    try {
        await section(page, 'rooms');
        await tabTo(page, page.locator('[data-start="bobross"]'));
        await page.keyboard.press('Enter');
        await expect(page.locator('[data-act-canvas]')).toBeVisible();
        const leave = page.getByRole('button', { name: 'Leave', exact: true });
        await tabTo(page, leave);
        await page.keyboard.press('Enter');
        await expect(page.locator('[data-chat-context]')).toHaveText('#stalemate');
        await expect(page.getByRole('tab', { name: '#stalemate', exact: true })).toBeFocused();
        expect(visitor.errors).toEqual([]);
    } finally { await visitor.close(); }
});

test('a delayed native close event cannot erase a reopened channel request and trap focus', async ({ browser, baseURL }) => {
    let holdNextReply = false, held = false, forwarding = Promise.resolve();
    const transportErrors = [];
    const visitor = await guest(browser, baseURL, 'NativeCloseGuest', { width: 1280, height: 900 }, undefined, async page => {
        await page.routeWebSocket(/\/sessions\/accessibility-/, socket => {
            const server = socket.connectToServer();
            server.onMessage(message => {
                const wait = holdNextReply && !held; if (wait) held = true;
                forwarding = forwarding.then(async () => {
                    // One named 150ms response-delay fixture, preserving all frame order.
                    if (wait) await delay(150);
                    socket.send(message);
                }).catch(error => transportErrors.push(error.message));
            });
        });
    });
    try {
        const dialog = visitor.page.locator('[data-channel-dialog]');
        await tabTo(visitor.page, visitor.page.locator('[data-start="chat"]')); await visitor.page.keyboard.press('Enter');
        await expect(dialog).toBeVisible();
        holdNextReply = true;
        // Deterministically reproduce native event ordering in one browser task:
        // close queues an event; reopening/submitting creates a newer request.
        // The main journey above independently uses actual keyboard events only.
        await visitor.page.evaluate(() => {
            document.querySelector('[data-channel-dialog]').close();
            document.querySelector('[data-start="chat"]').click();
            document.querySelector('[data-channel-name]').value = '#native-order-studio';
            document.querySelector('[data-channel-form]').requestSubmit();
        });
        await expect(visitor.page.locator('[data-chat-context]')).toHaveText('#native-order-studio');
        await expect(dialog).toBeHidden();
        await send(visitor.page, 'Keyboard chat remains reachable after reopening a channel dialog');
        await expect(visitor.page.locator('[data-buffer]')).toContainText('Keyboard chat remains reachable');
        expect(visitor.errors).toEqual([]); expect(transportErrors).toEqual([]);
    } finally { await visitor.close(); }
});

test('host command, camera and person dialogs expose visible headings as accessible names', async ({ browser, baseURL }) => {
    const relay = hangoutRelayWsBase(baseURL, `accessibility-${randomUUID()}`);
    const visitor = await guest(browser, baseURL, 'NamedDialogGuest', { width: 1280, height: 900 }, relay);
    let peer;
    try {
        // Native Safari can omit the modal's accessibility children when the
        // dialog follows the live workspace, even when role and name checks pass.
        const misplaced = await visitor.page.locator('dialog').evaluateAll(dialogs => {
            const workspace = document.querySelector('[data-app]');
            return dialogs.filter(dialog => dialog.parentElement !== document.body
                || !(dialog.compareDocumentPosition(workspace) & Node.DOCUMENT_POSITION_FOLLOWING))
                .map(dialog => dialog.getAttribute('aria-labelledby'));
        });
        expect(misplaced).toEqual([]);
        await send(visitor.page, '/join #art-dialog-studio');
        await expect(visitor.page.locator('[data-chat-context]')).toHaveText('#art-dialog-studio');
        await tabTo(visitor.page, visitor.page.locator('[data-roomtools]')); await visitor.page.keyboard.press('Enter');
        const dialog = visitor.page.locator('dialog[data-palette]');
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAccessibleName('Commands');
        await visitor.page.keyboard.press('Escape');
        await tabTo(visitor.page, visitor.page.locator('[data-cam]')); await visitor.page.keyboard.press('Enter');
        await expect(visitor.page.locator('dialog[data-cam-gate]')).toHaveAccessibleName('Camera on?');
        await visitor.page.keyboard.press('Escape'); await expect(visitor.page.locator('[data-cam]')).toBeFocused();
        peer = await guest(browser, baseURL, 'OtherKeyboardGuest', { width: 1280, height: 900 }, relay);
        await send(peer.page, '/join #art-dialog-studio');
        const person = visitor.page.locator('[data-nicks] button[data-self="false"]');
        await tabTo(visitor.page, person); await visitor.page.keyboard.press('Enter');
        await expect(visitor.page.locator('dialog[data-sheet]')).toHaveAccessibleName('OtherKeyboardGuest');
        await visitor.page.keyboard.press('Escape'); await expect(person).toBeFocused();
    } finally { await peer?.close(); await visitor.close(); }
});

const viewports = [
    { label: 'phone375', width: 375, height: 844 }, { label: 'phone390', width: 390, height: 844 },
    { label: 'reflow200-equivalent', width: 640, height: 512 }, { label: 'reflow400-equivalent', width: 320, height: 256 }
];
for (const viewport of viewports) test(`${viewport.label}: long chat, error and keyboard-focused composer stay contained`, async ({ browser, baseURL }, testInfo) => {
    const visitor = await guest(browser, baseURL, 'LongNickABCDEFGHIJKL', viewport), { page } = visitor;
    try {
        if (viewport.label.startsWith('phone')) {
            const starters = page.getByRole('region', { name: 'Conversation starters', exact: true });
            const row = starters.locator('.conversation-starters');
            const labels = ['Say hello', 'What are you making?', 'Find a collaborator'];
            await expect(starters.getByRole('button', { name: labels[2], exact: true })).toBeVisible();
            const rowFits = await row.evaluate(element => element.scrollWidth <= element.clientWidth);
            expect(rowFits).toBe(true);
            for (const label of labels) {
                const action = starters.getByRole('button', { name: label, exact: true });
                await expect(action).toBeInViewport({ ratio: 1 });
                await action.click({ trial: true });
            }
            contained(await composerGeometry(page));
            await page.screenshot({ path: testInfo.outputPath(`${viewport.label}-conversation-starters.png`) });
            await starters.getByRole('button', { name: 'Find a collaborator', exact: true }).click();
            const composer = page.getByRole('textbox', { name: 'Message', exact: true });
            const draft = 'Anyone up for drawing something together?';
            await expect(composer).toBeFocused();
            await expect(composer).toHaveValue(`${draft} `);
            await expect(page.getByRole('log', { name: 'Conversation' })).not.toContainText(draft);
        }
        const text = 'RiffGroove'.repeat(30);
        const roomText = 'StudioGroove'.repeat(25);
        await send(page, text); await expect(page.locator('[data-buffer]')).toContainText(text);
        const lobbyGeometry = await composerGeometry(page);
        await attachGeometry(testInfo, `lobby-geometry-${viewport.label}`, lobbyGeometry);
        await page.screenshot({ path: testInfo.outputPath(`${viewport.label}-lobby-long-message.png`), fullPage: true });
        contained(lobbyGeometry);
        await send(page, '/join #layout-studio'); await expect(page.locator('[data-chat-context]')).toHaveText('#layout-studio');
        await send(page, roomText); await expect(page.locator('[data-buffer]')).toContainText(roomText);
        await send(page, '/join #another-studio');
        await expect(page.getByRole('status').filter({ hasText: 'One new room per 10 minutes.' })).toBeVisible();
        await tabTo(page, page.getByRole('textbox', { name: 'Message', exact: true }));
        const geometry = await composerGeometry(page);
        await attachGeometry(testInfo, `geometry-${viewport.label}`, geometry);
        await page.screenshot({ path: testInfo.outputPath(`${viewport.label}-long-message-error.png`), fullPage: true });
        contained(geometry);
        if (viewport.width <= 480) expect(geometry.fontSize).toBe('16px');
        await section(page, 'rooms'); await tabTo(page, page.locator('[data-start="chat"]')); await page.keyboard.press('Enter');
        await expect(page.getByRole('dialog', { name: 'Your own #channel', exact: true })).toBeVisible();
        await page.keyboard.type('#art-this-name-belongs-to-drawing'); await page.keyboard.press('Enter');
        await expect(page.locator('[data-channel-error]')).toContainText('starts an activity room');
        await tabTo(page, page.locator('[data-channel-cancel]')); await page.keyboard.press('Enter');
        await expect(page.locator('[data-channel-dialog]')).toBeHidden();
        expect(visitor.errors).toEqual([]);
    } finally { await visitor.close(); }
});

test('short deep-zoom equivalent: Tab to Send keeps the whole composer visible before and after sending', async ({ browser, baseURL }, testInfo) => {
    // A real 1280px-wide Chrome window at 400% zoom leaves 320x232 CSS pixels
    // below browser chrome. This is its layout regression, not a zoom claim.
    const visitor = await guest(browser, baseURL, 'ShortZoomGuest', { width: 320, height: 232 }), { page } = visitor;
    try {
        await tabTo(page, page.getByRole('textbox', { name: 'Message', exact: true }));
        const text = 'Keyboard composer stays visible at deep zoom.';
        await page.keyboard.type(text); await page.keyboard.press(tabKey(page));
        await expect(page.locator('[data-send]')).toBeFocused();
        const before = await composerGeometry(page);
        await attachGeometry(testInfo, 'short-zoom-before-send', before);
        await page.screenshot({ path: testInfo.outputPath('short-zoom-before-send.png') });
        contained(before);
        await page.keyboard.press('Space');
        await expect(page.locator('[data-buffer]')).toContainText(text);
        contained(await composerGeometry(page));
        expect(visitor.errors).toEqual([]);
    } finally { await visitor.close(); }
});

// A retained rejected message adds a separate scrollable recovery row. Deep
// native Chrome zoom exposed clipping that the empty-recovery viewport probes
// did not cover. These dimensions are local reflow regressions; native zoom
// remains a separate observed browser journey.
for (const viewport of [{ width: 300, height: 299 }, { width: 320, height: 256 }]) test(`retained copy at ${viewport.width}x${viewport.height}: composer remains visible and keyboard usable`, async ({ browser, baseURL }, testInfo) => {
    const visitor = await guest(browser, baseURL, 'RecoveryReflow', viewport), { page } = visitor;
    try {
        await send(page, 'Native zoom reflow: ' + 'W'.repeat(260));
        await expect(page.locator('[data-message-recovery]')).toBeVisible();
        await expect(page.locator('[data-message-recovery-status]')).toContainText('1 not sent');
        // A rejected line still consumes the ordinary three-second slow-mode
        // window. Pace the next real request without changing server policy.
        await delay(3100);
        await tabTo(page, page.getByRole('textbox', { name: 'Message', exact: true }));
        const text = 'The composer and Send remain usable with a saved message copy.';
        await page.keyboard.type(text); await page.keyboard.press(tabKey(page));
        await expect(page.locator('[data-send]')).toBeFocused();
        await page.keyboard.press('Space');
        await expect(page.locator('[data-buffer]')).toContainText(text);
        await expect(page.locator('[data-message-recovery-status]')).toContainText('1 not sent');
        const geometry = await composerGeometry(page);
        await attachGeometry(testInfo, `retained-copy-${viewport.width}-${viewport.height}`, geometry);
        await page.screenshot({ path: testInfo.outputPath(`retained-copy-${viewport.width}-${viewport.height}.png`) });
        contained(geometry);
        expect(geometry.fontSize).toBe('16px');
        expect(visitor.errors).toEqual([]);
    } finally { await visitor.close(); }
});

const invitationViewports = [
    viewports[0], viewports[1], viewports[3], { label: 'desktop1440', width: 1440, height: 900 },
];
for (const viewport of invitationViewports) test(`${viewport.label}: invitation status action remains keyboard-reachable without covering chat input`, async ({ browser, baseURL }, testInfo) => {
    const relay = hangoutRelayWsBase(baseURL, `accessibility-${randomUUID()}`);
    const host = await guest(browser, baseURL, 'InvitationHost', { width: 1280, height: 900 }, relay);
    let visitor, holdJoin = false, dropFirstConfirmation;
    const heldJoinFrames = [];
    try {
        await send(host.page, '/join #invitation-studio');
        await expect(host.page.locator('[data-chat-context]')).toHaveText('#invitation-studio');
        visitor = await guest(browser, baseURL, 'InvitationGuest', viewport, relay, viewport.label === 'phone390' ? async page => {
            await page.routeWebSocket(/\/sessions\/accessibility-/, socket => {
                const server = socket.connectToServer();
                dropFirstConfirmation = () => {
                    holdJoin = false;
                    heldJoinFrames.length = 0;
                };
                server.onMessage(raw => {
                    const frame = JSON.parse(raw);
                    if (holdJoin && ((frame.t === 'join' && frame.ch.name === '#invitation-studio') || frame.t === 'room-join-result'))
                        heldJoinFrames.push(raw);
                    else socket.send(raw);
                });
            });
        } : undefined);
        await tabTo(visitor.page, visitor.page.getByRole('textbox', { name: 'Message', exact: true }));
        const announcement = visitor.page.getByRole('status').and(visitor.page.locator('[data-room-invite-announcement]'));
        await expect(announcement).toHaveText('');
        await send(host.page, '/invite InvitationGuest');
        const status = visitor.page.locator('[data-room-invite]');
        await expect(status).toContainText('invited you to #invitation-studio');
        await expect(announcement).toHaveText('InvitationHost invited you to #invitation-studio');
        await expect(visitor.page.getByRole('textbox', { name: 'Message', exact: true })).toBeFocused();
        if (viewport.label === 'phone375') {
            // Cross the previous deadline while focus remains in chat.
            await visitor.page.waitForTimeout(12200);
            await expect(status).toBeVisible();
        }
        await send(visitor.page, '/unknown-fixture');
        await expect(visitor.page.locator('[data-toast]')).toContainText('Unknown command');
        const geometry = await composerGeometry(visitor.page);
        await attachGeometry(testInfo, `invitation-geometry-${viewport.label}`, geometry);
        await visitor.page.screenshot({ path: testInfo.outputPath(`${viewport.label}-invitation.png`), fullPage: true });
        contained(geometry);
        const action = status.getByRole('button', { name: 'Join', exact: true });
        await expect(action).toHaveAccessibleDescription('InvitationHost invited you to #invitation-studio');
        await tabTo(visitor.page, action);
        await visitor.page.evaluate(() => {
            const focusedChannels = [];
            document.addEventListener('focusin', event => {
                if (event.target.matches('[data-tabs] [data-channel-key]')) focusedChannels.push(event.target.dataset.channelKey);
            });
            window.fixtureFocusedChannels = focusedChannels;
        });
        holdJoin = Boolean(dropFirstConfirmation);
        await visitor.page.keyboard.press('Enter');
        if (holdJoin) {
            await expect(status).toContainText('Waiting to join #invitation-studio');
            await expect(status.getByRole('button', { name: 'Joining…', exact: true })).toBeFocused();
            await expect.poll(() => heldJoinFrames.length).toBe(2);
            await visitor.page.screenshot({ path: testInfo.outputPath(`${viewport.label}-waiting-for-room.png`) });
            dropFirstConfirmation();
            const retry = status.getByRole('button', { name: 'Retry join', exact: true });
            await expect(retry).toBeVisible({ timeout: 12000 });
            await expect(retry).toBeFocused();
            await expect(visitor.page.locator('[data-buffer]')).not.toContainText('welcome to #invitation-studio');
            await visitor.page.screenshot({ path: testInfo.outputPath(`${viewport.label}-retry-room-join.png`) });
            await retry.press('Enter');
        }
        await expect(visitor.page.locator('[data-chat-context]')).toHaveText('#invitation-studio');
        await expect(status).toBeHidden();
        await expect(visitor.page.getByRole('tab', { name: '#invitation-studio', selected: true })).toBeFocused();
        expect(await visitor.page.evaluate(() => window.fixtureFocusedChannels)).toEqual(['#invitation-studio']);
        await visitor.page.screenshot({ path: testInfo.outputPath(`${viewport.label}-invitation-joined.png`) });
        await send(visitor.page, 'I found the invited room.');
        await expect(host.page.locator('[data-buffer]')).toContainText('I found the invited room.');
        expect(visitor.errors).toEqual([]); expect(host.errors).toEqual([]);
    } finally { await visitor?.close(); await host.close(); }
});

test('short reflow: the guest can dismiss a room invitation by keyboard', async ({ browser, baseURL }, testInfo) => {
    const relay = hangoutRelayWsBase(baseURL, `accessibility-${randomUUID()}`);
    const host = await guest(browser, baseURL, 'ShortInviteHost', { width: 1440, height: 900 }, relay);
    let visitor;
    try {
        await send(host.page, '/join #invite-dismiss');
        await expect(host.page.locator('[data-chat-context]')).toHaveText('#invite-dismiss');
        visitor = await guest(browser, baseURL, 'ShortInviteGuest', { width: 320, height: 256 }, relay);
        const { page } = visitor;
        await send(host.page, '/invite ShortInviteGuest');
        const invitation = page.locator('[data-room-invite]');
        await expect(invitation).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('01-short-invite-arrives.png') });

        const dismiss = invitation.getByRole('button', { name: 'Dismiss', exact: true });
        await tabTo(page, dismiss);
        await expect(dismiss).toBeFocused();
        await expect(dismiss).toBeInViewport({ ratio: 1 });
        const unobstructed = await dismiss.evaluate(button => {
            const bounds = button.getBoundingClientRect();
            const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
            return button.contains(hit);
        });
        expect(unobstructed).toBe(true);
        await page.screenshot({ path: testInfo.outputPath('02-short-dismiss-focused.png') });

        await page.keyboard.press('Enter');
        await expect(invitation).toBeHidden();
        const lobbyTab = page.getByRole('tab', { name: '#stalemate', selected: true });
        await expect(lobbyTab).toBeFocused();
        await expect(lobbyTab).toBeInViewport();
        await expect(page.locator('[data-chat-context]')).toHaveText('#stalemate');
        await expect(page.locator('[data-channel-key="#invite-dismiss"]')).toHaveCount(0);
        const message = page.getByRole('textbox', { name: 'Message', exact: true });
        await tabTo(page, message);
        await page.keyboard.type('Back in the short lobby.');
        await page.keyboard.press('Enter');
        await expect(page.locator('[data-buffer]')).toContainText('Back in the short lobby.');
        await expect(host.page.locator('[data-chat-context]')).toHaveText('#invite-dismiss');
        await expect(host.page.locator('[data-buffer]')).not.toContainText('Back in the short lobby.');
        await host.page.locator('[data-channel-key="#stalemate"]').click();
        await expect(host.page.locator('[data-chat-context]')).toHaveText('#stalemate');
        await expect(host.page.locator('[data-buffer]')).toContainText('Back in the short lobby.');
        await page.screenshot({ path: testInfo.outputPath('03-short-dismiss-recovered.png') });
        expect(visitor.errors).toEqual([]);
    } finally { await visitor?.close(); await host.close(); }
});

for (const viewport of [viewports[1], invitationViewports.at(-1)]) test(`${viewport.label}: two room invitations keep their Join actions in order`, async ({ browser, baseURL }, testInfo) => {
    const relay = hangoutRelayWsBase(baseURL, `accessibility-${randomUUID()}`);
    const firstHost = await guest(browser, baseURL, 'FirstStudioHost', { width: 1280, height: 900 }, relay);
    let secondHost, visitor;
    try {
        secondHost = await guest(browser, baseURL, 'SecondStudioHost', { width: 1280, height: 900 }, relay);
        visitor = await guest(browser, baseURL, 'TwoInviteGuest', viewport, relay);
        await send(firstHost.page, '/join #first-invite-studio');
        await send(secondHost.page, '/join #second-invite-studio');
        await expect(firstHost.page.locator('[data-chat-context]')).toHaveText('#first-invite-studio');
        await expect(secondHost.page.locator('[data-chat-context]')).toHaveText('#second-invite-studio');
        const panel = visitor.page.locator('[data-room-invite]');
        const join = panel.getByRole('button', { name: 'Join', exact: true });
        await send(firstHost.page, '/invite TwoInviteGuest');
        await tabTo(visitor.page, join);
        await send(secondHost.page, '/invite TwoInviteGuest');
        await expect(join).toHaveAccessibleDescription(/FirstStudioHost invited you to #first-invite-studio · 1 more invitation/);
        await expect(join).toBeFocused();
        await visitor.page.screenshot({ path: testInfo.outputPath(`${viewport.label}-queued-room-invites.png`) });
        await visitor.page.keyboard.press('Enter');
        await expect(visitor.page.locator('[data-chat-context]')).toHaveText('#first-invite-studio');
        await expect(join).toHaveAccessibleDescription('SecondStudioHost invited you to #second-invite-studio');
        await visitor.page.screenshot({ path: testInfo.outputPath(`${viewport.label}-next-room-invite.png`) });
        await join.press('Enter');
        await expect(visitor.page.locator('[data-chat-context]')).toHaveText('#second-invite-studio');
        await expect(panel).toBeHidden();
        expect(visitor.errors).toEqual([]);
    } finally { await visitor?.close(); await secondHost?.close(); await firstHost.close(); }
});

for (const viewport of [viewports[1], invitationViewports.at(-1)]) for (const queued of [false, true]) test(`${viewport.label}: a closed-room invitation leaves the guest in the lobby with recovery guidance${queued ? ' and the next invitation' : ''}`, async ({ browser, baseURL }, testInfo) => {
    const relay = hangoutRelayWsBase(baseURL, `accessibility-${randomUUID()}`);
    const host = await guest(browser, baseURL, 'ClosingInviteHost', { width: 1280, height: 900 }, relay);
    let visitor, nextHost, releaseRejection;
    const delayedRejection = queued && viewport.label === 'phone390';
    const heldRejection = [];
    try {
        await send(host.page, '/join #closed-invite-studio');
        await expect(host.page.locator('[data-chat-context]')).toHaveText('#closed-invite-studio');
        visitor = await guest(browser, baseURL, 'ClosingInviteGuest', viewport, relay, delayedRejection ? async page => {
            await page.routeWebSocket(/\/sessions\/accessibility-/, socket => {
                const server = socket.connectToServer();
                let hold = true;
                releaseRejection = () => {
                    hold = false;
                    for (const raw of heldRejection.splice(0)) socket.send(raw);
                };
                server.onMessage(raw => {
                    const frame = JSON.parse(raw);
                    const rejected = frame.t === 'room-join-result' && frame.status === 'rejected';
                    const guidance = frame.t === 'notice' && /That room changed or closed/.test(frame.text);
                    if (hold && (rejected || guidance)) heldRejection.push(raw);
                    else socket.send(raw);
                });
            });
        } : undefined);
        await send(host.page, '/invite ClosingInviteGuest');
        const invitation = visitor.page.locator('[data-room-invite]');
        const action = invitation.getByRole('button', { name: 'Join', exact: true });
        if (queued) {
            nextHost = await guest(browser, baseURL, 'NextInviteHost', { width: 1280, height: 900 }, relay);
            await send(nextHost.page, '/join #open-invite-studio');
            await expect(nextHost.page.locator('[data-chat-context]')).toHaveText('#open-invite-studio');
            await send(nextHost.page, '/invite ClosingInviteGuest');
            await expect(invitation).toContainText('1 more invitation');
        }
        await tabTo(visitor.page, action);
        await visitor.page.screenshot({ path: testInfo.outputPath(`${viewport.label}-closed-invite-before-accept.png`) });

        await send(host.page, '/close');
        await expect(host.page.locator('[data-chat-context]')).toHaveText('#stalemate');
        await visitor.page.keyboard.press('Enter');
        if (delayedRejection) {
            await expect.poll(() => heldRejection.length).toBe(2);
            const retry = invitation.getByRole('button', { name: 'Retry join', exact: true });
            await expect(retry).toBeVisible({ timeout: 12000 });
            await expect(retry).toBeFocused();
            await visitor.page.screenshot({ path: testInfo.outputPath('phone390-waiting-for-delayed-rejection.png') });
            releaseRejection();
        }
        await expect(visitor.page.locator('[data-toast]')).toContainText('That room changed or closed. Ask the host for a new invitation');
        await expect(visitor.page.locator('[data-chat-context]')).toHaveText('#stalemate');
        await expect(visitor.page.getByRole('tab', { name: '#closed-invite-studio' })).toHaveCount(0);
        if (queued) {
            await expect(action).toHaveAccessibleDescription('NextInviteHost invited you to #open-invite-studio');
            await expect(action).toBeFocused();
            await visitor.page.screenshot({ path: testInfo.outputPath(`${viewport.label}-next-invite-after-rejection.png`) });
            await visitor.page.keyboard.press('Enter');
            await expect(visitor.page.locator('[data-chat-context]')).toHaveText('#open-invite-studio');
            await expect(invitation).toBeHidden();
        } else {
            await expect(invitation).toBeHidden();
            await expect(visitor.page.getByRole('tab', { name: '#stalemate', selected: true })).toBeFocused();
            await visitor.page.screenshot({ path: testInfo.outputPath(`${viewport.label}-closed-invite-recovery.png`) });
            await send(visitor.page, 'Still in the lobby after that invitation.');
            await expect(host.page.locator('[data-buffer]')).toContainText('Still in the lobby after that invitation.');
        }
        expect(visitor.errors).toEqual([]); expect(host.errors).toEqual([]);
    } finally { await visitor?.close(); await nextHost?.close(); await host.close(); }
});

for (const viewport of [viewports[1], invitationViewports.at(-1)]) test(`${viewport.label}: chat stays keyboard-usable after a focused message is removed`, async ({ browser, baseURL }, testInfo) => {
    const relay = hangoutRelayWsBase(baseURL, `accessibility-${randomUUID()}`);
    const speaker = await guest(browser, baseURL, 'RemovalSpeaker', { width: 1280, height: 900 }, relay);
    let visitor, removeMessage;
    try {
        visitor = await guest(browser, baseURL, 'RemovalGuest', viewport, relay, async page => {
            await page.routeWebSocket(/\/sessions\/accessibility-/, socket => {
                socket.connectToServer();
                // Deliver a moderation event without creating reports or changing
                // the relay's thresholds. Ordinary chat still uses the real relay.
                removeMessage = id => socket.send(JSON.stringify({ t: 'delete', ids: [id] }));
            });
        });
        const { page } = visitor;
        await send(speaker.page, 'A synthetic message that will be removed.');
        const flag = page.getByRole('button', { name: 'Report this message from RemovalSpeaker' });
        await tabTo(page, flag);
        await page.screenshot({ path: testInfo.outputPath(`${viewport.label}-message-focused.png`) });
        removeMessage(await flag.evaluate(button => button.closest('li').dataset.id));
        await expect(flag).toHaveCount(0);
        const message = page.getByRole('textbox', { name: 'Message', exact: true });
        await expect(message).toBeFocused();
        await expect(message).toBeInViewport();
        await page.screenshot({ path: testInfo.outputPath(`${viewport.label}-focus-after-removal.png`) });
        await page.keyboard.type('Keyboard chat is still available.');
        await page.keyboard.press('Enter');
        await expect(speaker.page.locator('[data-buffer]')).toContainText('Keyboard chat is still available.');
        expect(visitor.errors).toEqual([]); expect(speaker.errors).toEqual([]);
    } finally { await visitor?.close(); await speaker.close(); }
});

test('a focused status survives its dismiss timer and dismisses after keyboard focus leaves', async ({ browser, baseURL }) => {
    const visitor = await guest(browser, baseURL, 'StatusKeyboardGuest', viewports[0]);
    try {
        await send(visitor.page, '/join #status-studio');
        await expect(visitor.page.locator('[data-chat-context]')).toHaveText('#status-studio');
        await send(visitor.page, '/join #another-studio');
        const status = visitor.page.locator('[data-toast]');
        await expect(status).toContainText('One new room per 10 minutes.');
        await tabTo(visitor.page, status);
        // Deliberately cross the real 4s dismiss deadline; fake browser time would
        // decouple WebSocket/ACK timers from the real local relay's clock.
        await visitor.page.waitForTimeout(4200);
        await expect(status).toBeVisible(); await expect(status).toBeFocused();
        await visitor.page.keyboard.press(tabKey(visitor.page));
        await expect(status).not.toBeFocused(); await expect(status).toBeHidden({ timeout: 5000 });
    } finally { await visitor.close(); }
});

test('reduced-motion settings and user-controlled announcements survive keyboard history navigation', async ({ browser, baseURL }) => {
    const visitor = await guest(browser, baseURL, 'QuietKeyboardGuest', { width: 1280, height: 900 }), { page } = visitor;
    try {
        expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
        const motion = await page.locator('[data-app]').evaluate(element => ({ scroll: getComputedStyle(element).scrollBehavior,
            durations: [...element.querySelectorAll('button')].map(button => getComputedStyle(button).transitionDuration) }));
        expect(motion.scroll).toBe('auto'); expect(motion.durations.every(value => value.split(',').every(duration => parseFloat(duration) === 0))).toBe(true);
        await send(page, '/join #quiet-studio'); await expect(page.locator('[data-chat-context]')).toHaveText('#quiet-studio');
        await send(page, 'Connected session lines remain readable while announcements are paused');
        await expect(page.locator('[data-buffer]')).toContainText('Connected session lines remain readable');
        await tabTo(page, page.locator('[data-chat-announcements]')); await page.keyboard.press('Space');
        await expect(page.getByRole('log', { name: 'Conversation' })).toHaveAttribute('aria-live', 'off');
        const active = page.locator('[role="tab"][aria-selected="true"]'); await tabTo(page, active);
        await page.keyboard.press('Home'); await page.keyboard.press('End');
        await expect(page.locator('[data-buffer]')).toContainText('Connected session lines remain readable');
        await expect(page.locator('[data-buffer]')).toHaveAttribute('aria-live', 'off');
        await tabTo(page, page.locator('[data-chat-announcements]')); await page.keyboard.press('Space');
        await expect(page.locator('[data-buffer]')).toHaveAttribute('aria-live', 'polite');
        expect(visitor.errors).toEqual([]);
    } finally { await visitor.close(); }
});

test('People roster: live joins preserve focused connection identity', async ({ browser, baseURL }) => {
    const relay = hangoutRelayWsBase(baseURL, `accessibility-${randomUUID()}`);
    const viewport = { width: 1280, height: 900 };
    const visitor = await guest(browser, baseURL, 'RosterNavigator', viewport, relay);
    let peer, arrival;
    try {
        peer = await guest(browser, baseURL, 'RosterPeer', viewport, relay);
        const ownName = visitor.page.locator('[data-nicks] span.nick[data-self="true"]');
        await expect(ownName).toHaveText('RosterNavigator');
        await expect(ownName).toHaveCSS('opacity', '1');
        // CSS adds decoration to the accessible name; exact DOM text still
        // selects one controlled peer within semantic People buttons.
        const person = visitor.page.locator('[data-nicks]').getByRole('button').filter({ hasText: /^RosterPeer$/ });
        await expect(person).toBeVisible();
        const connectionId = await visitor.page.evaluate(() =>
            window.__lobby.chans.get('#stalemate').names.find(member => member.nick === 'RosterPeer').id);
        expect(connectionId).toMatch(/^c[0-9a-f]{32}$/);
        await tabTo(visitor.page, person);

        // A genuine third admission produces the active channel's new roster.
        // The selected peer remains the same server-issued connection.
        arrival = await guest(browser, baseURL, 'RosterNewcomer', viewport, relay);
        await expect.poll(() => visitor.page.evaluate(() =>
            window.__lobby.chans.get('#stalemate').names.some(member => member.nick === 'RosterNewcomer'))).toBe(true);
        expect(await visitor.page.evaluate(id =>
            window.__lobby.chans.get('#stalemate').names.find(member => member.id === id)?.nick, connectionId)).toBe('RosterPeer');
        await expect(person).toBeFocused();
        await visitor.page.keyboard.press('Enter');
        await expect(visitor.page.locator('dialog[data-sheet]')).toHaveAccessibleName('RosterPeer');
        await visitor.page.keyboard.press('Escape');
        await expect(person).toBeFocused();

        expect(visitor.errors).toEqual([]); expect(peer.errors).toEqual([]); expect(arrival.errors).toEqual([]);
    } finally { await arrival?.close(); await peer?.close(); await visitor.close(); }
});

test('People roster: presence updates never steal the composer or its draft', async ({ browser, baseURL }) => {
    const relay = hangoutRelayWsBase(baseURL, `accessibility-${randomUUID()}`);
    const viewport = { width: 1280, height: 900 };
    const visitor = await guest(browser, baseURL, 'RosterWriter', viewport, relay);
    let peer, arrival;
    try {
        peer = await guest(browser, baseURL, 'RosterOther', viewport, relay);
        const composer = visitor.page.getByRole('textbox', { name: 'Message', exact: true });
        await tabTo(visitor.page, composer);
        await visitor.page.keyboard.type('An unsent draft while people come and go');
        arrival = await guest(browser, baseURL, 'RosterPassing', viewport, relay);
        await expect.poll(() => visitor.page.evaluate(() =>
            window.__lobby.chans.get('#stalemate').names.some(member => member.nick === 'RosterPassing'))).toBe(true);
        await expect(composer).toBeFocused();
        await expect(composer).toHaveValue('An unsent draft while people come and go');
        await arrival.close(); arrival = null;
        await expect.poll(() => visitor.page.evaluate(() =>
            window.__lobby.chans.get('#stalemate').names.some(member => member.nick === 'RosterPassing'))).toBe(false);
        await expect(composer).toBeFocused();
        await expect(composer).toHaveValue('An unsent draft while people come and go');
        expect(visitor.errors).toEqual([]); expect(peer.errors).toEqual([]);
    } finally { await arrival?.close(); await peer?.close(); await visitor.close(); }
});

test('People roster: a departed focused member falls back to the People heading', async ({ browser, baseURL }) => {
    const relay = hangoutRelayWsBase(baseURL, `accessibility-${randomUUID()}`);
    const viewport = { width: 1280, height: 900 };
    const visitor = await guest(browser, baseURL, 'RosterRemaining', viewport, relay);
    let peer, survivor;
    try {
        peer = await guest(browser, baseURL, 'RosterLeaving', viewport, relay);
        survivor = await guest(browser, baseURL, 'RosterStillHere', viewport, relay);
        const person = visitor.page.locator('[data-nicks]').getByRole('button').filter({ hasText: /^RosterLeaving$/ });
        await tabTo(visitor.page, person);
        const connectionId = await visitor.page.evaluate(() =>
            window.__lobby.chans.get('#stalemate').names.find(member => member.nick === 'RosterLeaving').id);
        await peer.close(); peer = null;
        await expect.poll(() => visitor.page.evaluate(id =>
            window.__lobby.chans.get('#stalemate').names.some(member => member.id === id), connectionId)).toBe(false);
        await expect(person).toHaveCount(0);
        const heading = visitor.page.locator('[data-people-title]');
        await expect(heading).toBeFocused();
        await expect(heading).toBeInViewport();
        const outline = await heading.evaluate(element => ({ width: getComputedStyle(element).outlineWidth,
            style: getComputedStyle(element).outlineStyle, color: getComputedStyle(element).outlineColor }));
        expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
        expect(outline.style).toBe('solid');
        expect(outline.color).not.toBe('rgba(0, 0, 0, 0)');
        await expect(visitor.page.locator('[data-nicks]').getByRole('button').filter({ hasText: /^RosterStillHere$/ })).toBeVisible();
        await expect(visitor.page.locator('dialog[data-sheet]')).toBeHidden();
        expect(visitor.errors).toEqual([]); expect(survivor.errors).toEqual([]);
    } finally { await survivor?.close(); await peer?.close(); await visitor.close(); }
});

test('People roster: a live join preserves the open person dialog and its native return target', async ({ browser, baseURL }) => {
    const relay = hangoutRelayWsBase(baseURL, `accessibility-${randomUUID()}`);
    const viewport = { width: 1280, height: 900 };
    const visitor = await guest(browser, baseURL, 'RosterDialog', viewport, relay);
    let peer, arrival;
    try {
        peer = await guest(browser, baseURL, 'RosterSheetPeer', viewport, relay);
        const person = visitor.page.locator('[data-nicks]').getByRole('button').filter({ hasText: /^RosterSheetPeer$/ });
        await tabTo(visitor.page, person);
        const opener = await person.elementHandle();
        const connectionId = await visitor.page.evaluate(() =>
            window.__lobby.chans.get('#stalemate').names.find(member => member.nick === 'RosterSheetPeer').id);
        await visitor.page.keyboard.press('Enter');
        const dialog = visitor.page.locator('dialog[data-sheet]');
        await expect(dialog).toHaveAccessibleName('RosterSheetPeer');
        const dialogControl = dialog.locator('button').first();
        await expect(dialogControl).toBeFocused();

        arrival = await guest(browser, baseURL, 'RosterSheetNew', viewport, relay);
        await expect.poll(() => visitor.page.evaluate(() =>
            window.__lobby.chans.get('#stalemate').names.some(member => member.nick === 'RosterSheetNew'))).toBe(true);
        expect(await visitor.page.evaluate(id =>
            window.__lobby.chans.get('#stalemate').names.find(member => member.id === id)?.nick, connectionId)).toBe('RosterSheetPeer');
        await expect(dialog).toBeVisible();
        await expect(dialogControl).toBeFocused();
        await visitor.page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(person).toBeFocused();
        expect(await opener.evaluate(element => element === document.activeElement)).toBe(true);
        expect(visitor.errors).toEqual([]); expect(peer.errors).toEqual([]); expect(arrival.errors).toEqual([]);
    } finally { await arrival?.close(); await peer?.close(); await visitor.close(); }
});

test('People roster: a departed person dialog returns to the visible heading on Escape', async ({ browser, baseURL }) => {
    const relay = hangoutRelayWsBase(baseURL, `accessibility-${randomUUID()}`);
    const viewport = { width: 1280, height: 900 };
    const visitor = await guest(browser, baseURL, 'RosterModal', viewport, relay);
    let peer, survivor;
    try {
        peer = await guest(browser, baseURL, 'RosterDeparting', viewport, relay);
        survivor = await guest(browser, baseURL, 'RosterModalOther', viewport, relay);
        const person = visitor.page.locator('[data-nicks]').getByRole('button').filter({ hasText: /^RosterDeparting$/ });
        await tabTo(visitor.page, person);
        const opener = await person.elementHandle();
        const connectionId = await visitor.page.evaluate(() =>
            window.__lobby.chans.get('#stalemate').names.find(member => member.nick === 'RosterDeparting').id);
        await visitor.page.keyboard.press('Enter');
        const dialog = visitor.page.locator('dialog[data-sheet]');
        await expect(dialog).toHaveAccessibleName('RosterDeparting');
        const dialogControl = dialog.locator('button').first();
        await expect(dialogControl).toBeFocused();

        await peer.close(); peer = null;
        await expect.poll(() => visitor.page.evaluate(id =>
            window.__lobby.chans.get('#stalemate').names.some(member => member.id === id), connectionId)).toBe(false);
        expect(await opener.evaluate(element => element.isConnected)).toBe(false);
        await expect(dialog).toBeVisible();
        await expect(dialogControl).toBeFocused();
        await visitor.page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        const heading = visitor.page.locator('[data-people-title]');
        await expect(heading).toBeFocused();
        await expect(heading).toBeInViewport();
        const outline = await heading.evaluate(element => ({ width: getComputedStyle(element).outlineWidth,
            style: getComputedStyle(element).outlineStyle, color: getComputedStyle(element).outlineColor }));
        expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
        expect(outline.style).toBe('solid');
        expect(outline.color).not.toBe('rgba(0, 0, 0, 0)');
        await expect(visitor.page.locator('[data-nicks]').getByRole('button').filter({ hasText: /^RosterModalOther$/ })).toBeVisible();
        expect(visitor.errors).toEqual([]); expect(survivor.errors).toEqual([]);
    } finally { await survivor?.close(); await peer?.close(); await visitor.close(); }
});

for (const failure of ['getter', 'getItem', 'setItem']) {
    test(`guest chat survives optional localStorage ${failure} failure`, async ({ browser, baseURL }) => {
        const visitor = await guest(browser, baseURL, 'StorageVisitor', { width: 375, height: 667 }, undefined, async page => {
            await page.addInitScript(mode => {
                window.__rememberFailures = 0;
                const fail = () => { window.__rememberFailures++; throw new DOMException('Optional browser storage unavailable', mode === 'setItem' ? 'QuotaExceededError' : 'SecurityError'); };
                if (mode === 'getter') Object.defineProperty(window, 'localStorage', { configurable: true, get: fail });
                else {
                    const store = window.localStorage, original = Storage.prototype[mode];
                    Storage.prototype[mode] = function (...args) {
                        if (this === store) return fail();
                        return original.apply(this, args);
                    };
                }
            }, failure);
        });
        try {
            await expect(visitor.page.locator('[data-app]')).toBeVisible();
            await expect(visitor.page.locator('[data-self-nick]')).toHaveText('StorageVisitor');
            await send(visitor.page, 'A real message without optional remembered storage');
            await expect(visitor.page.locator('[data-buffer]')).toContainText('A real message without optional remembered storage');
            expect(await visitor.page.evaluate(() => window.__rememberFailures)).toBeGreaterThan(0);
            contained(await composerGeometry(visitor.page));
            expect(visitor.errors).toEqual([]);
        } finally { await visitor.close(); }
    });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    for (const taken of [false, true]) test(`nickname ${taken ? 'conflict recovers' : 'entry moves focus into Chat'} at ${viewport.width}px`, async ({ browser, baseURL }, testInfo) => {
        const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
        let incumbent;
        try {
            const page = await context.newPage();
            await page.route(/youtube\.com|ytimg|googlevideo|goatcounter/, route => route.abort());
            const relay = hangoutRelayWsBase(baseURL, `keyboard-entry-${randomUUID()}`);
            if (taken) incumbent = await guest(browser, baseURL, 'FirstTimeGuest', viewport, relay);
            const source = taken ? 'stalemate' : 'rad-dad';
            await page.goto(`${ROOT}?preview=local-preview-key-0001&via=${source}&relay=${encodeURIComponent(relay)}`);
            const nickname = page.getByRole('textbox', { name: 'Your nick', exact: true });
            await tabTo(page, nickname);
            await page.keyboard.type('FirstTimeGuest');
            const enter = page.locator('[data-enter]');
            await tabTo(page, enter);
            await page.screenshot({ path: testInfo.outputPath('01-nickname-ready.png') });

            await page.keyboard.press('Space');
            if (taken) {
                const message = 'That nick is taken right now.';
                const status = page.locator('[data-gate-status]');
                await expect(status).toHaveText(message);
                await expect(nickname).toBeFocused();
                await expect(status).toBeInViewport({ ratio: 1 });
                await expect(nickname).toHaveAccessibleDescription(message);
                await page.screenshot({ path: testInfo.outputPath('01a-nickname-taken.png') });
                await expect(nickname).toHaveValue('FirstTimeGuest');
                await replaceText(page, 'AnotherGuest');
                await tabTo(page, enter);
                await page.keyboard.press('Space');
            }
            await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Community chat');
            await expect(page.locator('[data-chat-context]')).toHaveText('#stalemate');
            await page.screenshot({ path: testInfo.outputPath('02-entered-chat.png') });
            const chat = page.getByRole('region', { name: 'Chat', exact: true });
            await expect(chat).toBeFocused();
            await expect(chat).toBeInViewport();

            const message = 'Hello from my first Hang Out visit';
            await send(page, message);
            await expect(page.getByRole('log', { name: 'Conversation' })).toContainText(message);
            await page.screenshot({ path: testInfo.outputPath('03-first-chat-message.png') });
        } finally {
            await context.close();
            await incumbent?.close();
        }
    });

    test(`room closure returns tab focus to the lobby at ${viewport.width}px`, async ({ browser, baseURL }, testInfo) => {
        const relay = hangoutRelayWsBase(baseURL, `channel-tab-close-${randomUUID()}`);
        const host = await guest(browser, baseURL, 'TabClosingHost', viewport, relay);
        let visitor;
        try {
            await send(host.page, '/join #temporary-room');
            await expect(host.page.locator('[data-chat-context]')).toHaveText('#temporary-room');
            visitor = await guest(browser, baseURL, 'TabClosingGuest', viewport, relay);
            const { page } = visitor;
            await send(page, '/join #temporary-room');
            const tabs = page.getByRole('tablist', { name: 'Channels and direct messages' });
            const roomTab = tabs.getByRole('tab', { name: '#temporary-room', exact: true });
            const conversation = page.getByRole('log', { name: 'Conversation' });
            await expect(conversation).toHaveAccessibleDescription('#temporary-room');
            await tabTo(page, roomTab);
            await expect(roomTab).toBeInViewport();
            await roomTab.evaluate(tab => { window.fixtureOriginalRoomTab = tab; });
            await host.page.getByRole('tab', { name: '#stalemate', exact: true }).click();
            await send(host.page, 'A new message in the background lobby.');
            await expect(tabs.getByRole('tab', { name: /^#stalemate \(1\)$/ })).toBeVisible();
            expect(await roomTab.evaluate(tab => tab === window.fixtureOriginalRoomTab)).toBe(true);
            await expect(roomTab).toBeFocused();
            await page.screenshot({ path: testInfo.outputPath('01-before-room-closes.png') });

            await host.page.getByRole('tab', { name: '#temporary-room', exact: true }).click();
            await send(host.page, '/close');
            await expect(roomTab).toHaveCount(0);
            await expect(page.locator('[data-chat-context]')).toHaveText('#stalemate');
            await page.screenshot({ path: testInfo.outputPath('02-after-room-closes.png') });
            const lobbyTab = tabs.getByRole('tab', { name: '#stalemate', exact: true });
            await expect(conversation).toHaveAccessibleDescription('#stalemate');
            await expect(lobbyTab).toBeFocused();
            await expect(lobbyTab).toBeInViewport();
            const roomEntry = viewport.width === 390
                ? page.getByRole('button', { name: /start a room/i })
                : page.getByRole('complementary', { name: 'Rooms', exact: true })
                    .getByRole('button', { name: /^start a chat channel/i });
            await expect(roomEntry).toBeInViewport();
            await expect(roomEntry).toBeEnabled();

            const message = 'Back in the lobby after the room closed';
            await send(page, message);
            const sent = conversation.getByRole('listitem').filter({ hasText: message });
            const author = sent.locator('span.who');
            await expect(author).toHaveText('<TabClosingGuest>');
            await expect(author).toHaveCSS('opacity', '1');
            await page.screenshot({ path: testInfo.outputPath('03-lobby-message-sent.png') });
            expect(visitor.errors).toEqual([]);
            expect(host.errors).toEqual([]);
        } finally {
            await visitor?.close();
            await host.close();
        }
    });
}

for (const width of [375, 390, 1440]) {
    test(`room directory preserves keyboard identity and current capacity through live updates at ${width}px`, async ({ browser, baseURL }, testInfo) => {
        const relay = hangoutRelayWsBase(baseURL, `directory-${randomUUID()}`), viewport = { width, height: { 375: 667, 390: 844, 1440: 900 }[width] };
        const host = await guest(browser, baseURL, 'DirectoryHost', viewport, relay);
        const visitor = await guest(browser, baseURL, 'DirectoryReader', viewport, relay);
        let arrival;
        try {
            await send(host.page, '/join #directory-room');
            await expect(host.page.locator('[data-chat-context]')).toHaveText('#directory-room');
            const actions = visitor.page.locator('[data-quick]');
            const startRoom = width < 901
                ? actions.getByRole('button', { name: /start a room/i })
                : visitor.page.getByRole('complementary', { name: 'Rooms', exact: true })
                    .getByRole('button', { name: /^start a chat channel/i });
            if (await actions.evaluate(row => row.scrollWidth > row.clientWidth)) {
                await tabTo(visitor.page, actions.locator('[data-quick-cmd="help"]'));
                await expect.poll(() => actions.evaluate(row => row.scrollLeft)).toBeGreaterThan(0);
            }
            await section(visitor.page, 'rooms');
            const button = visitor.page.locator('[data-roomlist] button[data-room="#directory-room"]');
            const publicRoom = visitor.page.locator('[data-room="#directory-room"]');
            await expect(publicRoom).toHaveCount(1); await expect(publicRoom).toHaveJSProperty('tagName', 'BUTTON');
            await tabTo(visitor.page, button);
            const original = await button.elementHandle();
            arrival = await guest(browser, baseURL, 'DirectoryArrival', viewport, relay);
            await send(arrival.page, '/join #directory-room');
            await expect(button).toContainText('2/');
            await expect(publicRoom).toHaveCount(1); await expect(publicRoom).toHaveJSProperty('tagName', 'BUTTON');
            await expect(button).toBeFocused();
            expect(await button.evaluate((element, before) => element === before, original)).toBe(true);
            await send(host.page, '/mode +l 4');
            await expect(button).toContainText('2/4');
            await expect(publicRoom).toHaveCount(1); await expect(publicRoom).toHaveJSProperty('tagName', 'BUTTON');
            await expect(button).toBeFocused();
            expect(await button.evaluate((element, before) => element === before, original)).toBe(true);
            await visitor.page.screenshot({ path: testInfo.outputPath(`directory-before-join-${width}x${viewport.height}.png`) });
            await visitor.page.keyboard.press('Enter');
            await expect(visitor.page.locator('[data-chat-context]')).toHaveText('#directory-room');
            await expect(visitor.page.getByRole('tab', { name: '#directory-room', selected: true })).toBeFocused();
            await visitor.page.screenshot({ path: testInfo.outputPath(`directory-after-join-${width}x${viewport.height}.png`) });
            await expect.poll(() => actions.evaluate(row => row.scrollLeft)).toBe(0);
            await expect(startRoom).toBeInViewport({ ratio: 1 });
            const composer = visitor.page.getByRole('textbox', { name: 'Message', exact: true });
            await tabTo(visitor.page, composer); await visitor.page.keyboard.type('A draft while room metadata changes');
            await send(host.page, '/mode +l 5');
            await expect.poll(() => visitor.page.evaluate(() => window.__lobby.rooms.find(room => room.name === '#directory-room')?.max)).toBe(5);
            await expect(publicRoom).toHaveCount(1); await expect(publicRoom).toHaveJSProperty('tagName', 'BUTTON');
            await expect(composer).toBeFocused(); await expect(composer).toHaveValue('A draft while room metadata changes');
            contained(await composerGeometry(visitor.page));
            expect(visitor.errors).toEqual([]); expect(host.errors).toEqual([]); expect(arrival.errors).toEqual([]);
        } finally { await arrival?.close(); await visitor.close(); await host.close(); }
    });

}

for (const width of [375, 390, 1440]) {
    test(`a removed focused room returns to the visible directory filter at ${width}px`, async ({ browser, baseURL }, testInfo) => {
        const relay = hangoutRelayWsBase(baseURL, `directory-removal-${randomUUID()}`), viewport = { width, height: { 375: 667, 390: 844, 1440: 900 }[width] };
        const host = await guest(browser, baseURL, 'ClosingHost', viewport, relay);
        let holdDirectory = false, releaseDirectory;
        const visitor = await guest(browser, baseURL, 'DirectoryGuest', viewport, relay, async page => {
            await page.routeWebSocket(/\/sessions\/directory-removal-/, socket => {
                const server = socket.connectToServer();
                server.onMessage(message => {
                    if (holdDirectory && JSON.parse(message).t === 'list') {
                        // Hold just this directory update to reproduce a stale row.
                        releaseDirectory = () => socket.send(message);
                    } else socket.send(message);
                });
            });
        });
        try {
            await send(host.page, '/join #vanishing-room');
            await expect(host.page.locator('[data-chat-context]')).toHaveText('#vanishing-room');
            await section(visitor.page, 'rooms');
            const button = visitor.page.locator('[data-roomlist] button[data-room="#vanishing-room"]');
            const publicRoom = visitor.page.locator('[data-room="#vanishing-room"]');
            await expect(publicRoom).toHaveCount(1); await expect(publicRoom).toHaveJSProperty('tagName', 'BUTTON');
            await tabTo(visitor.page, button);
            await send(host.page, '/mode +l 1');
            await expect(button).toBeDisabled();
            await expect(publicRoom).toHaveCount(1); await expect(publicRoom).toHaveJSProperty('tagName', 'BUTTON');
            const fallback = visitor.page.getByRole('combobox', { name: 'Room directory', exact: true });
            await expect(fallback).toBeFocused();
            await send(host.page, '/mode +l 2');
            await expect(button).toBeEnabled(); await expect(fallback).toBeFocused();
            await expect(publicRoom).toHaveCount(1); await expect(publicRoom).toHaveJSProperty('tagName', 'BUTTON');
            await tabTo(visitor.page, button);
            holdDirectory = true;
            await send(host.page, '/close');
            await expect(host.page.locator('[data-chat-context]')).toHaveText('#stalemate');
            await expect.poll(() => Boolean(releaseDirectory)).toBe(true);
            await visitor.page.screenshot({ path: testInfo.outputPath(`stale-directory-before-join-${width}x${viewport.height}.png`) });
            await visitor.page.keyboard.press('Enter');
            await expect(visitor.page.locator('[data-toast]')).toContainText('That room changed or closed.');
            holdDirectory = false;
            releaseDirectory();
            await expect(button).toHaveCount(0);
            await expect(publicRoom).toHaveCount(0);
            await expect(fallback).toBeFocused(); await expect(fallback).toBeInViewport();
            await expect(fallback).toHaveValue('active');
            await expect(visitor.page.locator('dialog[open]')).toHaveCount(0);
            await expect(visitor.page.locator('[data-chat-context]')).toHaveText('#stalemate');
            await visitor.page.screenshot({ path: testInfo.outputPath(`stale-directory-recovered-${width}x${viewport.height}.png`) });
            expect(visitor.errors).toEqual([]); expect(host.errors).toEqual([]);
        } finally { await visitor.close(); await host.close(); }
    });
}


// Actual guest/room/clipboard UI at a short phone viewport. The sole refusal
// fixture is clipboard.writeText; invitations never launch an app or leave this tab.
for (const width of [375, 390]) test(`short Jam instructions and manual invite copy keep the composer usable at ${width}px`, async ({ browser, baseURL }, testInfo) => {
    testInfo.annotations.push({ type: 'scope', description: 'Actual guest, local relay, private Jam room and keyboard UI; explicit clipboard NotAllowedError fixture only. No native app/audio, hosted, physical phone or native clipboard-policy qualification.' });
    const invitation = `Join beta rehearsal on WebJam:\nKeep this room open.\nOpen WebJam, choose Join, then paste this full invitation.\nwebjam://join?v=3&r=direct-stun&i=opaque_fixture_only\nwebjam-signal:V0pTRQ${'x'.repeat(3000)}`;
    const topic = `${'Rehearsal notes '.repeat(10).slice(0, 159)}!`;
    expect(topic).toHaveLength(160);
    const visitor = await guest(browser, baseURL, `ShortJam${width}`, { width, height: 667 }, undefined, async page => {
        await page.addInitScript(() => {
            window.__shortJamClipboardRefusals = 0;
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
                writeText: async () => {
                    window.__shortJamClipboardRefusals += 1;
                    throw new DOMException('Clipboard access refused by this fixture', 'NotAllowedError');
                }
            } });
        });
    });
    const { page } = visitor;
    let popups = 0;
    page.on('popup', popup => { popups += 1; void popup.close(); });
    try {
        await section(page, 'rooms');
        await tabTo(page, page.locator('[data-start="jam"]')); await page.keyboard.press('Enter');
        await expect(page.locator('[data-jam]')).toBeVisible();
        await expect(page.locator('[data-modes]')).toContainText('+ti');
        await expect(page.locator('[data-chat-context]')).toContainText('#jam-');
        const admittedURL = page.url();
        await tabTo(page, page.locator('[data-roomtools]')); await page.keyboard.press('Enter');
        const palette = page.locator('dialog[data-palette]');
        await expect(palette).toBeVisible();
        page.once('dialog', async dialog => {
            expect(dialog.type()).toBe('prompt');
            await dialog.accept(topic);
        });
        await tabTo(page, palette.getByRole('button', { name: '/topic …', exact: true })); await page.keyboard.press('Enter');
        await expect(palette).toBeHidden(); await expect(page.locator('[data-topic]')).toHaveText(topic);

        // Focus only Jam controls during setup; do not focus/scroll the composer
        // before observing either layout, since that could mask overflow clipping.
        const editor = page.locator('[data-jam-link]');
        await tabTo(page, editor); await page.keyboard.insertText(invitation);
        await tabTo(page, page.locator('[data-jam-form] button[type="submit"]')); await page.keyboard.press('Space');
        const copy = page.locator('[data-jam-copy]');
        await expect(copy).toBeVisible();
        await expect(page.locator('[data-jam]')).toContainText('Windows and Linux require pasting private invites');
        await expect(page.locator('[data-jam-web]')).toBeDisabled();
        await expect(page.locator('[data-jam-desktop]')).toBeHidden();
        const standard = await composerGeometry(page);
        await attachGeometry(testInfo, `short-jam-standard-${width}`, standard);
        await page.screenshot({ path: testInfo.outputPath(`short-jam-standard-${width}.png`), fullPage: true });

        await tabTo(page, copy); await page.keyboard.press('Space');
        const fallback = page.locator('[data-jam-copy-value]');
        await expect(fallback).toBeVisible(); await expect(fallback).toBeFocused(); await expect(fallback).toHaveValue(invitation);
        expect(await fallback.evaluate(input => input.selectionEnd - input.selectionStart)).toBe(invitation.length);
        expect(await page.evaluate(() => window.__shortJamClipboardRefusals)).toBe(1);
        const manualCopy = await composerGeometry(page);
        // First retain the natural fallback layout. Then scroll the panel past
        // Copy invite without changing focus, so Shift-Tab must actually reveal
        // it in either engine (WebKit may leave it visible in its initial view).
        const naturalCopyScroll = await page.locator('[data-jam]').evaluate(panel => ({ scrollTop: panel.scrollTop, scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight }));
        const beforeNativeTab = await page.locator('[data-jam]').evaluate(panel => {
            panel.scrollTop = panel.scrollHeight;
            return { scrollTop: panel.scrollTop, scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight };
        });
        await attachGeometry(testInfo, `short-jam-manual-copy-${width}`, { ...manualCopy, jam: naturalCopyScroll, keyboardScrollStart: beforeNativeTab });
        await page.screenshot({ path: testInfo.outputPath(`short-jam-manual-copy-${width}.png`), fullPage: true });

        // These first containment checks use the snapshots taken without a
        // composer focus action, not geometry repaired by focusing Message.
        contained(standard); contained(manualCopy);
        expect(standard.fontSize).toBe('16px'); expect(manualCopy.fontSize).toBe('16px');
        expect(beforeNativeTab.scrollHeight).toBeGreaterThan(beforeNativeTab.clientHeight);
        await page.keyboard.press(tabKey(page, true)); await expect(copy).toBeFocused();
        const afterNativeTab = await copy.evaluate(button => {
            const panel = button.closest('[data-jam]'), r = button.getBoundingClientRect(), p = panel.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { scrollTop: panel.scrollTop, buttonTop: r.top, buttonBottom: r.bottom, panelTop: p.top + panel.clientTop,
                panelBottom: p.top + panel.clientTop + panel.clientHeight, uncovered: hit === button || button.contains(hit) };
        });
        await attachGeometry(testInfo, `short-jam-native-tab-${width}`, { before: beforeNativeTab, after: afterNativeTab });
        expect(afterNativeTab.scrollTop).toBeLessThan(beforeNativeTab.scrollTop);
        expect(afterNativeTab.buttonTop).toBeGreaterThanOrEqual(afterNativeTab.panelTop);
        expect(afterNativeTab.buttonBottom).toBeLessThanOrEqual(afterNativeTab.panelBottom);
        expect(afterNativeTab.uncovered).toBe(true);
        await tabTo(page, page.getByRole('textbox', { name: 'Message', exact: true }));
        await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeFocused();
        expect(await page.evaluate(expected => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }).includes(expected), invitation)).toBe(false);
        await expect(page).toHaveURL(admittedURL); expect(popups).toBe(0); expect(visitor.errors).toEqual([]);
    } finally { await visitor.close(); }
});
