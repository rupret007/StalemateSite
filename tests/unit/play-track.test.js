// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(join(root, 'scripts/play-track.js'), 'utf8');
const trackSource = readFileSync(join(root, 'js/track.js'), 'utf8');
const pages = [];

function boot(path, body, suite) {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    url: `https://example.test${path}`, runScripts: 'outside-only'
  });
  pages.push(dom);
  const win = dom.window;
  Object.defineProperty(win.HTMLElement.prototype, 'offsetParent', { get() { return this.hidden ? null : win.document.body; } });
  win.document.addEventListener('click', (event) => event.preventDefault(), true);
  win.goatcounter = { count: vi.fn() };
  if (suite) win.Suite = suite;
  win.eval(trackSource);
  win.eval(source);
  return { win, paths: () => win.goatcounter.count.mock.calls.map(([event]) => event.path) };
}

function click(win, selector) {
  win.document.querySelector(selector).dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
}

async function settle(win) {
  await new Promise((resolve) => win.setTimeout(resolve, 5));
}

afterEach(() => {
  pages.splice(0).forEach((dom) => dom.window.close());
});

describe('shared arcade music analytics', () => {
  it('awaits the real shared player and reports generic playback once across playlist songs', async () => {
    let resolvePlayer;
    const music = vi.fn(() => new Promise((resolve) => { resolvePlayer = resolve; }));
    const { win, paths } = boot('/StalemateSite/play/TurdAnoid.html', '<button id="btnStart">Start</button>', { music });
    const audio = win.document.createElement('audio');
    audio.dispatchEvent(new win.Event('play'));
    expect(paths()).toEqual([]);
    resolvePlayer({ audioElement: audio });
    await settle(win);
    audio.dispatchEvent(new win.Event('play'));
    audio.dispatchEvent(new win.Event('play'));
    expect(music).toHaveBeenCalledTimes(1);
    expect(paths()).toEqual(['music-ingame-play']);
    expect(paths()).not.toContain('music-ingame-manic-play');
    click(win, '#btnStart');
    expect(paths()).toContain('play-turdanoid-start');
  });

  it('follows both sound controls, including a shared toggle mounted after the promise resolves', async () => {
    let enabled = true;
    let resolvePlayer;
    const suite = {
      music: () => new Promise((resolve) => { resolvePlayer = resolve; }),
      isMusicEnabled: () => enabled, isMuted: () => false
    };
    const { win, paths } = boot('/play/turdomania.html', '<button id="btnSound">Sound</button><div id="board"></div><div id="overlay"></div>', suite);
    const audio = win.document.createElement('audio');
    Object.defineProperty(audio, 'paused', { writable: true, value: false });
    resolvePlayer({ audioElement: audio });
    await settle(win);
    const toggle = win.document.createElement('button');
    toggle.id = 'suite-music-toggle';
    toggle.innerHTML = '<span>Music</span>';
    win.document.body.appendChild(toggle);
    enabled = false;
    audio.paused = true;
    click(win, '#suite-music-toggle span');
    await settle(win);
    expect(paths().filter((path) => path === 'music-ingame-mute')).toHaveLength(1);
    enabled = true;
    win.soundBlocked = () => true;
    click(win, '#btnSound');
    await settle(win);
    expect(paths().filter((path) => path === 'music-ingame-mute')).toHaveLength(2);
    win.soundBlocked = () => false;
    audio.paused = false;
    click(win, '#suite-music-toggle');
    await settle(win);
    expect(paths().filter((path) => path === 'music-ingame-mute')).toHaveLength(2);
  });

  it.each(['reject', 'throw'])('keeps ordinary game events working when music loading fails: %s', async (failure) => {
    const music = () => {
      if (failure === 'throw') throw new Error('optional player unavailable');
      return Promise.reject(new Error('optional player unavailable'));
    };
    const { win, paths } = boot('/play/TurdAnoid.html', '<button id="btnStart">Start</button>', { music });
    await settle(win);
    click(win, '#btnStart');
    expect(paths()).toEqual(['play-turdanoid-start']);
  });
});

describe('ordinary arcade analytics', () => {
  it.each(['/play/', '/StalemateSite/play/index.html'])('tracks game cards on the hub at %s', (path) => {
    const { win, paths } = boot(path, '<a class="game-card" href="TurdAnoid.html"><span>Turdanoid</span></a><a class="game-card" href="turdomania.html">Turdomania</a>');
    click(win, '.game-card span');
    click(win, '.game-card[href="turdomania.html"]');
    expect(paths()).toEqual(['hub-open', 'hub-card-turdanoid', 'hub-card-turdomania']);
  });

  it.each(['/play/turdomania.html', '/StalemateSite/play/turdomania.html?daily=2026-10-21&v=1'])('keeps free-play start and completion events fixed at %s', async (path) => {
    const { win, paths } = boot(path, '<div id="board"></div><div id="overlay"></div>');
    const board = win.document.getElementById('board');
    board.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
    board.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const overlay = win.document.getElementById('overlay');
    overlay.classList.add('show');
    await settle(win);
    overlay.classList.remove('show');
    await settle(win);
    overlay.classList.add('show');
    await settle(win);
    expect(paths()).toEqual(['play-turdomania-start', 'play-turdomania-over', 'play-turdomania-dur-lt30s']);
    for (const [payload] of win.goatcounter.count.mock.calls) {
      expect(Object.keys(payload).sort()).toEqual(['event', 'path', 'title']);
      expect(payload.title).toBe(payload.path);
      expect(payload.event).toBe(true);
    }
  });

  it('does not count an already-visible end screen as a new game or completion', async () => {
    const { win, paths } = boot('/play/turdomania.html', '<div id="board"></div><div id="overlay" class="show"></div>');
    await settle(win);
    expect(paths()).toEqual([]);
  });
});
