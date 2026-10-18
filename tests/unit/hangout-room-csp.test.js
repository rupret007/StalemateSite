// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOM = join(fileURLToPath(new URL('../..', import.meta.url)), 'r', '45662413410ed051');
const relayMeta = readFileSync(join(ROOM, 'index.html'), 'utf8').match(/name="hangout-relay" content="([^"]+)"/)[1];

const ROOM_CSP =
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://www.youtube.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' "
    + `${relayMeta}; worker-src 'self' blob:; frame-src https://www.youtube.com; object-src 'none'; base-uri 'self'; form-action 'none'`;

function cspFromHtml(html) {
    const m = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
    return m ? m[1] : null;
}

describe('hangout room page CSP', () => {
    it('allows same-origin modules, wasm compile, and the production relay wss origin', () => {
        expect(relayMeta).toMatch(/^wss:\/\//);
        expect(ROOM_CSP).toContain("'wasm-unsafe-eval'");
        expect(ROOM_CSP).toContain(`connect-src 'self' ${relayMeta}`);
        expect(ROOM_CSP).not.toMatch(/\*/);
        expect(ROOM_CSP).not.toMatch(/http:/);
    });

    it('index.html carries exactly the room CSP meta', () => {
        const html = readFileSync(join(ROOM, 'index.html'), 'utf8');
        expect(cspFromHtml(html)).toBe(ROOM_CSP);
        const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
        for (const [, attrs, body] of blocks) {
            expect(attrs).toMatch(/\ssrc=/);
            expect(body.trim()).toBe('');
        }
    });
});
