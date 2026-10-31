import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const contactFormSource = readFileSync(join(repoRoot, 'js/contact-form.js'), 'utf8');

const CONTACT_MARKUP = `
<div data-contact-thanks class="contact-thanks panel" hidden tabindex="-1">Thanks</div>
<div data-contact-panel class="contact-panel">
  <form class="mail-form" data-contact-form method="POST" action="https://formsubmit.co/stalemate.punk@gmail.com">
    <input type="hidden" name="_next" value="https://stalemate.band/?contact=sent#contact">
  </form>
</div>`;

function runContactFormAt(url) {
    window.history.replaceState({}, '', url);
    document.body.innerHTML = CONTACT_MARKUP;
    window.eval(contactFormSource);
}

describe('contact-form.js', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('rewrites _next to the current page URL with contact=sent', () => {
        runContactFormAt('/play/');
        const next = document.querySelector('input[name="_next"]');
        expect(next).toBeTruthy();
        expect(next.value).toBe(`${window.location.origin}/play/?contact=sent#contact`);
    });

    it('shows thank-you, hides the form panel, and focuses thanks when contact=sent', () => {
        runContactFormAt('/?contact=sent');
        const thanks = document.querySelector('[data-contact-thanks]');
        const panel = document.querySelector('[data-contact-panel]');
        expect(thanks.hidden).toBe(false);
        expect(panel.hidden).toBe(true);
        expect(document.activeElement).toBe(thanks);
    });

    it('does not toggle thank-you or panel visibility without contact=sent', () => {
        runContactFormAt('/#contact');
        const thanks = document.querySelector('[data-contact-thanks]');
        const panel = document.querySelector('[data-contact-panel]');
        expect(thanks.hidden).toBe(true);
        expect(panel.hidden).toBe(false);
    });
});
