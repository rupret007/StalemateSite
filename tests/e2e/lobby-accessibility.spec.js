// Actual keyboard events and local WebSockets. Responsive viewport checks are
// zoom/reflow equivalents, not native browser zoom, screen-reader speech or iOS.
const { randomUUID } = require('node:crypto');
const { writeFile } = require('node:fs/promises');
const { setTimeout: delay } = require('node:timers/promises');
const { test, expect } = require('@playwright/test');
const { hangoutRelayWsBase } = require('../../scripts/lib/e2e-test-server.cjs');
const ROOT = '/r/45662413410ed051/lobby/';

async function tabTo(page, target) {
    await expect(target).toBeVisible();
    for (let i = 0; i < 90; i += 1) {
        if (await target.evaluate(element => element === document.activeElement)) return;
        await page.keyboard.press('Tab');
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

for (const viewport of [viewports[0], viewports[3]]) test(`${viewport.label}: invitation status action remains keyboard-reachable without covering chat input`, async ({ browser, baseURL }, testInfo) => {
    const relay = hangoutRelayWsBase(baseURL, `accessibility-${randomUUID()}`);
    const host = await guest(browser, baseURL, 'InvitationHost', { width: 1280, height: 900 }, relay);
    let visitor;
    try {
        await send(host.page, '/join #invitation-studio');
        await expect(host.page.locator('[data-chat-context]')).toHaveText('#invitation-studio');
        visitor = await guest(browser, baseURL, 'InvitationGuest', viewport, relay);
        await tabTo(visitor.page, visitor.page.getByRole('textbox', { name: 'Message', exact: true }));
        await send(host.page, '/invite InvitationGuest');
        const status = visitor.page.locator('[data-toast]');
        await expect(status).toContainText('invited you to #invitation-studio');
        const geometry = await composerGeometry(visitor.page);
        await attachGeometry(testInfo, `invitation-geometry-${viewport.label}`, geometry);
        await visitor.page.screenshot({ path: testInfo.outputPath(`${viewport.label}-invitation.png`), fullPage: true });
        contained(geometry);
        const action = status.getByRole('button', { name: 'Join', exact: true });
        await tabTo(visitor.page, action);
        if (viewport.label === 'phone375') {
            // Cross the real actionable-notice deadline while its button holds focus.
            await visitor.page.waitForTimeout(12200);
            await expect(status).toBeVisible(); await expect(action).toBeFocused();
        }
        await visitor.page.keyboard.press('Enter');
        await expect(visitor.page.locator('[data-chat-context]')).toHaveText('#invitation-studio');
        await expect(status).toBeHidden();
        expect(visitor.errors).toEqual([]); expect(host.errors).toEqual([]);
    } finally { await visitor?.close(); await host.close(); }
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
        await visitor.page.keyboard.press('Tab');
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

for (const width of [375, 390]) {
    test(`room directory preserves keyboard identity and current capacity through live updates at ${width}px`, async ({ browser, baseURL }) => {
        const relay = hangoutRelayWsBase(baseURL, `directory-${randomUUID()}`), viewport = { width, height: 667 };
        const host = await guest(browser, baseURL, 'DirectoryHost', viewport, relay);
        const visitor = await guest(browser, baseURL, 'DirectoryReader', viewport, relay);
        let arrival;
        try {
            await send(host.page, '/join #directory-room');
            await expect(host.page.locator('[data-chat-context]')).toHaveText('#directory-room');
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
            await visitor.page.keyboard.press('Enter');
            await expect(visitor.page.locator('[data-chat-context]')).toHaveText('#directory-room');
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

    test(`a removed focused room returns to the visible directory filter at ${width}px`, async ({ browser, baseURL }) => {
        const relay = hangoutRelayWsBase(baseURL, `directory-removal-${randomUUID()}`), viewport = { width, height: 667 };
        const host = await guest(browser, baseURL, 'ClosingHost', viewport, relay);
        const visitor = await guest(browser, baseURL, 'DirectoryGuest', viewport, relay);
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
            await send(host.page, '/close');
            await expect(button).toHaveCount(0);
            await expect(publicRoom).toHaveCount(0);
            await expect(fallback).toBeFocused(); await expect(fallback).toBeInViewport();
            await expect(fallback).toHaveValue('active');
            await expect(visitor.page.locator('dialog[open]')).toHaveCount(0);
            await expect(visitor.page.locator('[data-chat-context]')).toHaveText('#stalemate');
            expect(visitor.errors).toEqual([]); expect(host.errors).toEqual([]);
        } finally { await visitor.close(); await host.close(); }
    });
}
