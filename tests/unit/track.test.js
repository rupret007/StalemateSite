// @vitest-environment node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const trackSource = readFileSync(join(repoRoot, 'js/track.js'), 'utf8');

function loadTrack() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://127.0.0.1:4320/',
    runScripts: 'outside-only'
  });
  dom.window.eval(trackSource);
  return dom.window;
}

describe('js/track.js', () => {
  let win;

  beforeEach(() => {
    win = loadTrack();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('no-ops when goatcounter is missing', () => {
    expect(() => win.smTrack('music-spotify')).not.toThrow();
  });

  it('sanitizes event names and sends via goatcounter.count', () => {
    const count = vi.fn();
    win.goatcounter = { count };
    win.smTrack('Music Spotify!!!');
    expect(count).toHaveBeenCalledWith({
      path: 'music-spotify',
      title: 'music-spotify',
      event: true
    });
  });

  it('queues a few events and flushes when goatcounter appears late', () => {
    win.smTrack('nav-listen');
    win.smTrack('nav-games');
    const count = vi.fn();
    win.goatcounter = { count };
    win.smTrackFlush();
    expect(count).toHaveBeenCalledTimes(2);
    expect(count.mock.calls[0][0].path).toBe('nav-listen');
  });

  it('maps duration buckets', () => {
    expect(win.smDurBucket(10)).toBe('lt30s');
    expect(win.smDurBucket(90)).toBe('30s-2m');
    expect(win.smDurBucket(200)).toBe('2-5m');
    expect(win.smDurBucket(600)).toBe('5-15m');
    expect(win.smDurBucket(2000)).toBe('15m+');
  });

  it('caps level labels at 10plus', () => {
    expect(win.smLevelCap(3)).toBe('3');
    expect(win.smLevelCap(9)).toBe('9');
    expect(win.smLevelCap(10)).toBe('10plus');
    expect(win.smLevelCap(99)).toBe('10plus');
  });

  it('smOnce fires at most once per page per name', () => {
    const spy = vi.fn();
    win.smOnce('scroll-home-25', spy);
    win.smOnce('scroll-home-25', spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
