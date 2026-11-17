// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../r/45662413410ed051/lobby/index.html', import.meta.url), 'utf8');
const guard = readFileSync(new URL('../../r/45662413410ed051/lobby/lobby-startup.js', import.meta.url), 'utf8');
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
