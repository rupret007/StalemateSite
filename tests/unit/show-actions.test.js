// @vitest-environment node
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';
const html = readFileSync('index.html', 'utf8');
it('uses the confirmed performance start in an interoperable UTC calendar without an invented finish', () => {
    const dom = new JSDOM(html);
    const link = dom.window.document.querySelector('[data-track="show-calendar"]');
    const ics = readFileSync(link.getAttribute('href'), 'utf8');
    const unfolded = ics.replace(/\r\n[ \t]/g, '');
    const start = unfolded.match(/^DTSTART:(.+)$/m)[1].trim();
    const iso = start.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
    expect(Date.parse(iso)).toBe(Date.parse(dom.window.document.querySelector('[data-next-show]').dataset.startsAt));
    expect(unfolded).toContain('SUMMARY:Stalemate at Rockin');
    expect(unfolded).toContain('8604 Preston Rd Suite 100');
    expect(unfolded).not.toMatch(/^DTEND:|^DURATION:/m);
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    const maps = new URL(dom.window.document.querySelector('[data-track="show-directions"]').href);
    expect(maps.origin + maps.pathname).toBe('https://www.google.com/maps/dir/');
    expect(maps.searchParams.get('api')).toBe('1');
    expect(maps.searchParams.get('destination')).toContain('8604 Preston Rd Suite 100, Plano TX 75024');
    dom.window.close();
});
