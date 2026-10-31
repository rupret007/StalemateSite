// @vitest-environment node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const SOCIAL = [
    'https://www.instagram.com/stalemate.punk/',
    'https://www.youtube.com/@stalemate.punkband',
    'https://www.facebook.com/stalemate.band/'
];
const ROCKIN = 'https://rockinoctober.com';

function countHrefs(root, href) {
    return root.querySelectorAll(`a[href="${href}"]`).length;
}

function loadPage(relativePath) {
    const html = readFileSync(path.join(repoRoot, relativePath), 'utf8');
    return new JSDOM(html).window.document;
}

describe('link dedupe per page region', () => {
    it('homepage: at most one of each social and Rockin’ October link per region', () => {
        const doc = loadPage('index.html');
        const regions = [
            ['site-header', doc.querySelector('.site-header')],
            ['#home', doc.querySelector('#home')],
            ['.site-footer', doc.querySelector('.site-footer')]
        ];
        for (const [name, el] of regions) {
            expect(el, name).toBeTruthy();
            const scope = name === 'site-header' ? el.querySelector('.social-nav') : el;
            expect(scope, `${name} scope`).toBeTruthy();
            for (const href of SOCIAL) {
                expect(countHrefs(scope, href), `${name} ${href}`).toBeLessThanOrEqual(1);
            }
            if (name !== 'site-header') {
                expect(countHrefs(el, ROCKIN), `${name} rockinoctober`).toBeLessThanOrEqual(1);
            }
        }
        expect(countHrefs(doc.querySelector('#home'), ROCKIN), '#home rockinoctober').toBeLessThanOrEqual(1);
        expect(doc.querySelectorAll('#home .social-nav')).toHaveLength(0);
    });

    it('QR page: one social block in main follow section only', () => {
        const doc = loadPage('qr/index.html');
        expect(doc.querySelectorAll('header .social-link')).toHaveLength(0);
        const follow = doc.querySelector('.qr-follow');
        for (const href of SOCIAL) {
            expect(countHrefs(follow, href)).toBe(1);
        }
    });
});
