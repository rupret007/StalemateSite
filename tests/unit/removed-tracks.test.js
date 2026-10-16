// @vitest-environment node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APPLE_LINKS, SPOTIFY_LINKS } from './streaming-allowlist.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

describe("'Over 18' (1997) is removed (it was a mix-up with It's Only Been 18)", () => {
  for (const f of ['index.html', 'README.md']) {
    it(`${f} has no Over 18 entry, link or ID`, () => {
      const text = readFileSync(join(root, f), 'utf8');
      for (const gone of ['Over 18', 'over-18-1997', '1718884699', '5d7NzhgfZgFBvKiYa63xea']) expect(text).not.toContain(gone);
    });
  }
  it('the Listen section lists exactly Andrea and It’s Only Been 18', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    const titles = [...html.matchAll(/<h3 class="listen-track__title">([^<]+)<\/h3>/g)].map((m) => m[1]);
    expect(titles).toEqual(['Andrea', 'It’s Only Been 18']);
  });
  it('the streaming allowlist no longer accepts its links', () => {
    expect(SPOTIFY_LINKS.has('https://open.spotify.com/track/5d7NzhgfZgFBvKiYa63xea')).toBe(false);
    expect(APPLE_LINKS.has('https://music.apple.com/us/album/over-18-1997/1718884118?i=1718884699')).toBe(false);
  });
});
