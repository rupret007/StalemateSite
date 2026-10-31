// @vitest-environment node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(fileURLToPath(new URL('../..', import.meta.url)));

const CONTACT_NAV_PAGES = [
    { file: 'index.html', contactHref: '#contact' },
    { file: '404.html', contactHref: './#contact' },
    { file: 'qr/index.html', contactHref: '../#contact' },
    { file: 'play/index.html', contactHref: '../#contact' },
    { file: 'tap/index.html', contactHref: '../#contact' }
];

function navBlocks(html) {
    const blocks = [];
    const navRe = /<nav\b[^>]*>[\s\S]*?<\/nav>/gi;
    let match;
    while ((match = navRe.exec(html)) !== null) {
        blocks.push(match[0]);
    }
    return blocks;
}

function hasContactLink(html, href) {
    const needle = `href="${href}"`;
    const alt = `href='${href}'`;
    return navBlocks(html).some((block) => block.includes(needle) || block.includes(alt));
}

describe('contact section', () => {
    it('homepage form posts to FormSubmit with fields, honeypot, and captcha off', () => {
        const html = readFileSync(join(repoRoot, 'index.html'), 'utf8');
        expect(html).toContain('id="contact"');
        expect(html).toMatch(/action="https:\/\/formsubmit\.co\/stalemate\.punk@gmail\.com"/);
        expect(html).toMatch(/name="name"/);
        expect(html).toMatch(/name="email"/);
        expect(html).toMatch(/name="message"/);
        expect(html).toMatch(/name="_honey"/);
        expect(html).toMatch(/name="_captcha"/);
        expect(html).toMatch(/name="_next"/);
        expect(html).toContain('data-contact-form');
        const withoutNoscript = html.replace(/<noscript>[\s\S]*?<\/noscript>/gi, '');
        expect(withoutNoscript).not.toMatch(/mailto:stalemate\.punk@gmail\.com/);
        expect(html).toMatch(/<noscript>[\s\S]*stalemate\.punk@gmail\.com[\s\S]*<\/noscript>/);
        expect(html).toContain('https://www.facebook.com/stalemate.band/');
    });

    it('packages contact scripts for Pages', () => {
        const script = readFileSync(join(repoRoot, 'scripts/package-pages.cjs'), 'utf8');
        expect(script).toContain('js/contact-mail.js');
        expect(script).toContain('js/contact-form.js');
    });

    for (const { file, contactHref } of CONTACT_NAV_PAGES) {
        it(`${file} links Contact from header and footer navigation`, () => {
            const html = readFileSync(join(repoRoot, file), 'utf8');
            expect(html, file).toMatch(/>\s*Contact\s*</);
            expect(hasContactLink(html, contactHref), file).toBe(true);
            const footerMatch = html.match(/<footer[\s\S]*?<\/footer>/i);
            expect(footerMatch, file).toBeTruthy();
            expect(footerMatch[0], file).toContain('Contact');
            expect(footerMatch[0], file).toMatch(new RegExp(`href=["']${contactHref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`));
        });
    }
});
