// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`../../r/45662413410ed051/${name}`, import.meta.url), 'utf8');
const windows = [];
afterEach(() => { for (const window of windows.splice(0)) window.close(); });

function fixture({ narrow = false } = {}) {
    const { window } = new JSDOM(read('index.html'), { url: 'http://127.0.0.1:4320/', runScripts: 'outside-only' });
    windows.push(window);
    const { document } = window;
    const $ = (selector) => document.querySelector(selector);
    const capture = vi.fn(() => new Promise(() => {}));
    window.matchMedia = (query) => ({
        matches: narrow && query === '(max-width: 820px)', addEventListener() {}
    });
    Object.defineProperty(window.navigator, 'mediaDevices', { value: { getUserMedia: capture } });
    window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {} });
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    for (const script of ['sync-core.js', 'private-snapshot.js', 'private-recovery.js', 'video-core.js',
        'youtube-player.js', 'turn-client.js', 'bob-ross.js', 'names.js', 'room.js', 'room-workspace.js']) {
        window.eval(read(script));
    }
    $('[data-room]').hidden = false;
    return { $, window, document, capture };
}

it('opens the room chat, returns focus when closing, and retains an unsent message', () => {
    const { $, window, document, capture } = fixture();
    const open = $('[data-room-chat-open]');
    const close = $('[data-room-chat-close]');
    const chat = document.getElementById(open.getAttribute('aria-controls'));
    const heading = document.getElementById(chat.getAttribute('aria-labelledby'));
    const input = $('[data-text]');
    input.value = 'An unsent note';
    expect(capture).not.toHaveBeenCalled();

    close.click();
    expect($('[data-room]').hasAttribute('data-room-chat-closed')).toBe(true);
    expect(open.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(open);

    open.click();
    expect($('[data-room]').hasAttribute('data-room-chat-closed')).toBe(false);
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(heading);
    expect(input.value).toBe('An unsent note');

    input.focus();
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(open);
    expect(input.value).toBe('An unsent note');
    expect(capture).not.toHaveBeenCalled();
});

it('collapses Chat on entry to a phone call until the guest opens it', async () => {
    const { $, document, capture } = fixture({ narrow: true });
    const button = $('[data-room-chat-open]');
    const room = $('[data-room]');
    document.body.classList.add('faces-on');
    await Promise.resolve();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(room.hasAttribute('data-room-chat-shown')).toBe(false);

    button.click();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(room.hasAttribute('data-room-chat-shown')).toBe(true);

    expect(capture).not.toHaveBeenCalled();
});

it('keeps Chat and its focused draft visible as a phone call begins', async () => {
    const { $, document, capture } = fixture({ narrow: true });
    const button = $('[data-room-chat-open]');
    const input = $('[data-text]');
    expect($('[data-room]').hasAttribute('data-room-chat-shown')).toBe(false);
    input.value = 'A draft while entering a call';
    input.focus();
    document.body.classList.add('faces-on');
    await Promise.resolve();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('A draft while entering a call');
    expect(capture).not.toHaveBeenCalled();
});

it('focuses the pinned controls without changing room admission state', () => {
    const { $, document, window, capture } = fixture();
    window.history.replaceState(null, '', '#fixture-invitation');
    $('[data-room-controls-jump]').click();
    expect(document.activeElement).toBe($('#room-call-controls'));
    expect(window.location.hash).toBe('#fixture-invitation');
    expect(capture).not.toHaveBeenCalled();
});

it.each([['[data-workspace-start-video]', 'video'], ['[data-cam]', 'video'], ['[data-mic]', 'audio']])('starts %s capture only after confirmation', async (selector, kind) => {
    const { $, document, capture } = fixture();
    const control = $(selector);
    const dialog = $('[data-ask]');
    const yes = $('[data-ask-yes]');
    const no = $('[data-ask-no]');
    expect($(kind === 'video' ? '[data-cam]' : '[data-mic]').getAttribute('aria-pressed')).toBe('false');
    expect(capture).not.toHaveBeenCalled();

    control.click();
    expect(dialog.open).toBe(true);
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent).toMatch(/Turn on your/);
    expect(capture).not.toHaveBeenCalled();
    no.click();
    await Promise.resolve();
    expect(dialog.open).toBe(false);
    expect(capture).not.toHaveBeenCalled();

    control.click();
    yes.click();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(Object.keys(capture.mock.calls[0][0])).toEqual([kind]);
});
