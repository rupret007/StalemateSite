// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createHangoutClientTestModules } from './hangout-lobby-client-stub.mjs';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

import { productFile } from '../support/product-room.cjs';
const html = readFileSync(productFile('lobby/index.html'), 'utf8');
const guard = readFileSync(productFile('lobby/lobby-startup.js'), 'utf8');
const client = readFileSync(productFile('lobby/lobby.js'), 'utf8');
const discovery = readFileSync(productFile('lobby/discovery-core.js'), 'utf8');
const windows = [];
afterEach(() => { for (const dom of windows.splice(0)) dom.window.close(); });

function visitor() {
    const dom = new JSDOM(html, { url: 'https://localhost/', runScripts: 'outside-only' });
    windows.push(dom);
    const { window } = dom, { document } = window, timers = new Map();
    let sequence = 0;
    window.setTimeout = (callback, delay) => { timers.set(++sequence, { callback, delay }); return sequence; };
    window.clearTimeout = key => timers.delete(key);
    window.eval(guard);
    return { window, document, timers, notice: document.querySelector('[data-startup-recovery]'),
        main: document.querySelector('[data-lobby-module]'), enter: document.querySelector('[data-enter]'),
        ready: () => document.dispatchEvent(new window.Event('hangout:lobby-ready')) };
}

it('loads the independent recovery guard before the module without inline script or handler', () => {
    const { document, main } = visitor();
    expect(main.previousElementSibling.getAttribute('src')).toBe('lobby-startup.js');
    expect(document.querySelector('[data-startup-reload]').getAttribute('onclick')).toBeNull();
    expect(document.querySelector('noscript').textContent).toContain('Enable it for this site');
});

it('explains an actual module error without moving nickname focus or joining', () => {
    const { window, document, main, notice, enter, timers } = visitor();
    const nick = document.querySelector('[data-nick]'); nick.value = 'MyChosenNick'; nick.focus();
    main.dispatchEvent(new window.Event('error'));
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain('Chat could not load. Check your connection, then reload chat.');
    expect(document.activeElement).toBe(nick); expect(nick.value).toBe('MyChosenNick');
    expect(enter.disabled).toBe(true); expect(timers.size).toBe(0);
    expect(document.querySelector('[data-startup-reload]').disabled).toBe(false);
});

it('does not let module download completion stand in for completed initialization', () => {
    const { window, main, notice, enter } = visitor();
    enter.disabled = false;
    main.dispatchEvent(new window.Event('load'));
    expect(notice.hidden).toBe(false); expect(enter.disabled).toBe(true);
});

it('ignores unrelated resource failures', () => {
    const { window, document, notice, timers } = visitor();
    const image = document.createElement('img'); document.body.append(image);
    image.dispatchEvent(new window.Event('error'));
    document.querySelector('script[src="../names.js"]').dispatchEvent(new window.Event('load'));
    expect(notice.hidden).toBe(true); expect(timers.size).toBe(1);
});

it('lets a slow download finish without stealing focus, changing the nick or auto-reloading', () => {
    const { window, document, notice, timers, ready, main } = visitor();
    const nick = document.querySelector('[data-nick]'); nick.value = 'StillWaiting'; nick.focus();
    const task = [...timers.values()][0]; expect(task.delay).toBe(12000); task.callback();
    expect(notice.hidden).toBe(false); expect(notice.textContent).toContain('You can keep waiting or reload chat');
    expect(document.activeElement).toBe(nick);
    ready(); main.dispatchEvent(new window.Event('load'));
    expect(notice.hidden).toBe(true); expect(timers.size).toBe(0);
    expect(nick.value).toBe('StillWaiting'); expect(document.activeElement).toBe(nick);
});

it('leaves normal entry alone after readiness and ignores late errors', () => {
    const { window, main, ready, notice, enter, timers } = visitor();
    enter.disabled = false; ready(); main.dispatchEvent(new window.Event('error'));
    expect(notice.hidden).toBe(true); expect(enter.disabled).toBe(false); expect(timers.size).toBe(0);
});

it('cancels its waiting timer when the visitor leaves', () => {
    const { window, timers } = visitor();
    window.dispatchEvent(new window.Event('pagehide'));
    expect(timers.size).toBe(0);
});

// Execute actual client initialization in the same DOM as the startup guard.
// Only ESM loading is replaced, as in the existing client-context unit fixture.
function initialize({ privateShell = true, cachedPreview = false } = {}) {
    const app = visitor(), { window, document, main } = app;
    if (privateShell) {
        const marker = document.createElement('script'); marker.src = '/beta/bootstrap.js'; document.head.append(marker);
        // betaFetch injects the protected page's same-origin relay even when
        // its separate bootstrap script fails. Raw source HTML is unconfigured.
        document.querySelector('meta[name="hangout-relay"]').content = window.location.origin.replace(/^http/, 'ws');
    }
    if (cachedPreview) window.sessionStorage.setItem('hangout-preview', 'local-preview-key-0001');
    let readyEvents = 0;
    document.addEventListener('hangout:lobby-ready', () => readyEvents++);
    window.WebSocket = class { constructor() { throw new Error('Initialization must not connect chat'); } };
    window.fetch = vi.fn();
    window.HangoutClientTestModules = createHangoutClientTestModules(window);
    window.eval(discovery);
    const imports = [...client.matchAll(/^import \{([^}]+)\} from '[^']+';/gm)].map(match => match[1]).join(',');
    window.eval(`const entrance = window.HangoutClientTestModules; const {${imports}} = entrance;\n${client.replace(/^import .*$/gm, '')}`);
    main.dispatchEvent(new window.Event('load'));
    expect(window.fetch).not.toHaveBeenCalled();
    return { ...app, readyEvents };
}

it('offers recovery for a private first visit with missing bootstrap data instead of saying the site is closed', () => {
    const { document, notice, enter, readyEvents } = initialize();
    expect(readyEvents).toBe(0); expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain('Check your connection, then reload chat');
    expect(document.querySelector('[data-gate-copy]').textContent).not.toContain('Not open yet');
    expect(document.querySelector('.nickrow').hidden).toBe(false);
    expect(enter.hidden).toBe(false); expect(enter.disabled).toBe(true);
});

it('keeps the existing in-tab preview fallback without autojoining for returning private visitors', () => {
    const { notice, enter, readyEvents } = initialize({ cachedPreview: true });
    expect(readyEvents).toBe(1); expect(notice.hidden).toBe(true);
    expect(enter.hidden).toBe(false); expect(enter.disabled).toBe(false);
});

it('keeps the unconfigured public-preview message separate from private setup failure', () => {
    const { document, notice, enter, readyEvents } = initialize({ privateShell: false });
    expect(readyEvents).toBe(1); expect(notice.hidden).toBe(true);
    expect(document.querySelector('[data-gate-copy]').textContent).toContain('Not open yet');
    expect(enter.hidden).toBe(true); expect(enter.disabled).toBe(true);
});


it('keeps the typed name and explains manual entry when the optional name generator is unavailable', () => {
    const { window, document, enter } = initialize({ cachedPreview: true });
    const nick = document.querySelector('[data-nick]'); nick.value = 'MyChosenNick';
    document.querySelector('[data-reroll]').click();
    expect(nick.value).toBe('MyChosenNick'); expect(document.activeElement).toBe(nick);
    expect(nick.getAttribute('aria-describedby')).toBe('gate-status');
    expect(document.querySelector('[data-gate-status]').textContent).toBe('Random names aren’t available right now. Type a nickname to join.');
    expect(enter.disabled).toBe(false); expect(window.fetch).not.toHaveBeenCalled();
});

it('keeps name entry usable without exposing an exception if name generation fails', () => {
    const { window, document, enter } = initialize({ cachedPreview: true });
    window.StaleNames = { roll() { throw new Error('SYNTHETIC_PRIVATE_NAME_DETAIL'); } };
    const nick = document.querySelector('[data-nick]'); nick.value = 'KeepThisName';
    document.querySelector('[data-reroll]').click();
    expect(nick.value).toBe('KeepThisName'); expect(document.activeElement).toBe(nick);
    expect(nick.getAttribute('aria-describedby')).toBe('gate-status');
    const text = document.querySelector('[data-gate-status]').textContent;
    expect(text).toBe('Random names aren’t available right now. Type a nickname to join.');
    expect(text).not.toContain('SYNTHETIC_PRIVATE_NAME_DETAIL');
    expect(enter.disabled).toBe(false); expect(window.fetch).not.toHaveBeenCalled();
});

it('clears the name-picker recovery hint when a later explicit roll succeeds', () => {
    const { window, document } = initialize({ cachedPreview: true });
    const nick = document.querySelector('[data-nick]'), roll = document.querySelector('[data-reroll]');
    nick.value = 'EarlierChoice'; roll.click();
    expect(nick.getAttribute('aria-describedby')).toBe('gate-status');
    window.StaleNames = { roll: () => ({ name: 'HappyPine', legendary: false }) };
    roll.click();
    expect(nick.value).toBe('HappyPine'); expect(document.activeElement).toBe(nick);
    expect(nick.hasAttribute('aria-describedby')).toBe(false);
    expect(document.querySelector('[data-gate-status]').textContent).toBe('');
    expect(roll.textContent).toBe('🎲 Roll again'); expect(window.fetch).not.toHaveBeenCalled();
});


it.each([{ isComposing: true }, { isComposing: false, keyCode: 229 }])('does not join while Enter confirms nickname composition, then joins the final choice (%j)', async composition => {
    const { window, document } = initialize({ cachedPreview: true });
    const sockets = [];
    window.WebSocket = class {
        readyState = 0;
        constructor() { sockets.push(this); }
        send() {}
        close() { this.readyState = 3; }
    };
    const nick = document.querySelector('[data-nick]');
    nick.focus(); nick.value = 'UnfinishedNick';
    const status = document.querySelector('[data-gate-status]').textContent;
    nick.dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true }));
    nick.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', ...composition, bubbles: true, cancelable: true }));
    await Promise.resolve(); await Promise.resolve();
    expect(sockets).toHaveLength(0);
    expect(document.querySelector('[data-enter]').disabled).toBe(false);
    expect(document.querySelector('[data-gate-status]').textContent).toBe(status);
    expect(document.activeElement).toBe(nick);
    expect(nick.value).toBe('UnfinishedNick');
    nick.value = 'ChosenNick';
    nick.dispatchEvent(new window.CompositionEvent('compositionend', { data: 'ChosenNick', bubbles: true }));
    await Promise.resolve();
    expect(sockets).toHaveLength(0);
    nick.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await Promise.resolve(); await Promise.resolve();
    expect(sockets).toHaveLength(1);
    expect(document.querySelector('[data-enter]').disabled).toBe(true);
    expect(nick.value).toBe('ChosenNick');
    expect(window.fetch).not.toHaveBeenCalled();
});
