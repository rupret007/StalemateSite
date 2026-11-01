// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(fileURLToPath(new URL('../..', import.meta.url)));
const SLUG = '45662413410ed051';
const ROOM = join(repoRoot, 'r', SLUG);
const GOATCOUNTER = 'https://stalemate.goatcounter.com';

const relayMeta = readFileSync(join(ROOM, 'index.html'), 'utf8').match(/name="hangout-relay" content="([^"]+)"/)[1];
const HANGOUT_PAGE_CSP =
    `default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' ${relayMeta} ${GOATCOUNTER}; object-src 'none'; base-uri 'none'; form-action 'none'`;
const LOBBY_PAGE_CSP =
    `default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://www.youtube.com; frame-src https://challenges.cloudflare.com https://www.youtube.com; media-src 'self' blob:; connect-src 'self' ${relayMeta} ${GOATCOUNTER}; object-src 'none'; base-uri 'none'; form-action 'none'`;

const PAGES = ['lobby/index.html', 'admin/index.html', 'terms/index.html'];

function cspFromHtml(html) {
    const m = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
    return m ? m[1] : null;
}

function assertNoInlineScript(html, page) {
    const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    for (const [, attrs, body] of blocks) {
        expect(attrs, `${page}: script tags must load external files only`).toMatch(/\ssrc=/);
        expect(body.trim(), `${page}: no inline script bodies`).toBe('');
    }
    expect(html, `${page}: no javascript: URLs`).not.toMatch(/\s(?:href|src)\s*=\s*["']javascript:/i);
}

describe('hangout lobby pages CSP', () => {
    it('uses the production relay and GoatCounter in connect-src', () => {
        expect(relayMeta).toMatch(/^wss:\/\//);
        expect(HANGOUT_PAGE_CSP).toContain(`connect-src 'self' ${relayMeta} ${GOATCOUNTER}`);
    });

    for (const page of PAGES) {
        it(`${page} carries exactly the hangout CSP meta and no inline scripts`, () => {
            const html = readFileSync(join(ROOM, page), 'utf8');
            const expected = page === 'lobby/index.html' ? LOBBY_PAGE_CSP : HANGOUT_PAGE_CSP;
            expect(cspFromHtml(html)).toBe(expected);
            assertNoInlineScript(html, page);
        });
    }
});
