/* Shared progressive enhancement. Navigation, tickets, music names and
   mailing-list copy all work without JavaScript. */
(function () {
    'use strict';
    let initialized = false;

    function start() {
        if (initialized) return;
        initialized = true;

        const logo = document.getElementById('logo');
        function showLogoFallback() {
            if (!logo) return;
            logo.hidden = true;
            const brand = logo.closest('.brand');
            if (brand && !brand.querySelector('.logo-fallback')) {
                const fallback = document.createElement('span');
                fallback.className = 'logo-fallback';
                fallback.textContent = 'STALEMATE';
                brand.prepend(fallback);
            }
        }
        if (logo) {
            logo.addEventListener('error', showLogoFallback);
            if (logo.complete && logo.naturalWidth === 0) showLogoFallback();
        }

        const header = document.querySelector('.site-header');
        function measureHeader() {
            const height = header?.getBoundingClientRect().height;
            if (height > 0) {
                document.documentElement.style.setProperty('--header-height', `${Math.ceil(height)}px`);
            }
        }
        if (header && 'ResizeObserver' in window) new ResizeObserver(measureHeader).observe(header);
        window.addEventListener('resize', measureHeader, { passive: true });
        measureHeader();

        if (window.matchMedia) {
            document.documentElement.classList.toggle(
                'motion-ok',
                !window.matchMedia('(prefers-reduced-motion: reduce)').matches
            );
        }

        document.querySelectorAll('[data-load-preview]').forEach((button) => {
            const host = button.closest('[data-embed]') || button.parentElement;
            const template = host?.querySelector('template[data-preview-template]');
            if (!host || !template || !template.content.querySelector('iframe')) return;
            button.hidden = false;
            button.addEventListener('click', () => {
                if (host.querySelector('iframe')) return;
                host.append(template.content.cloneNode(true));
                button.hidden = true;
            });
            window.addEventListener('pagehide', () => {
                host.querySelectorAll('iframe').forEach((frame) => frame.remove());
                button.hidden = false;
            });
        });

        const mailing = document.querySelector('[data-mailing-form]');
        const mailingStatus = document.querySelector('[data-mailing-status]');
        if (mailing && mailingStatus) {
            mailing.addEventListener('submit', (event) => {
                event.preventDefault();
                mailingStatus.textContent = 'Mailing list tool not connected yet [MAILING LIST TOOL NEEDED].';
            });
        }

        const share = document.querySelector('[data-share-band]');
        const status = document.querySelector('[data-share-status]');
        const fallback = document.querySelector('[data-share-fallback]');
        const copy = document.querySelector('[data-copy-band]');
        if (!share || !status || !fallback || !copy) return;

        const bandUrl = (window.StalemateSite && window.StalemateSite.publicUrl())
            || 'https://rupret007.github.io/StalemateSite/';
        let busy = false;
        let generation = 0;
        share.hidden = false;
        const showFallback = () => {
            fallback.hidden = false;
            status.textContent = 'Copy the band website below.';
        };
        const setBusy = (value) => {
            busy = value;
            share.disabled = value;
            copy.disabled = value;
        };
        share.addEventListener('click', async () => {
            if (busy) return;
            if (typeof navigator.share !== 'function') {
                showFallback();
                return;
            }
            setBusy(true);
            const request = ++generation;
            status.textContent = '';
            try {
                await navigator.share({
                    title: 'Stalemate',
                    text: 'Ska/punk originals from Stalemate.',
                    url: bandUrl
                });
                if (request === generation) status.textContent = 'Sharing options closed.';
            } catch (error) {
                if (request !== generation) return;
                if (error?.name === 'AbortError') {
                    fallback.hidden = false;
                    status.textContent = 'Sharing canceled or unavailable.';
                } else showFallback();
            } finally {
                if (request === generation) setBusy(false);
            }
        });
        copy.addEventListener('click', async () => {
            if (busy) return;
            setBusy(true);
            const request = ++generation;
            try {
                if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
                await navigator.clipboard.writeText(bandUrl);
                if (request === generation) status.textContent = 'Band website copied.';
            } catch {
                if (request === generation) status.textContent = 'Select the website address and copy it manually.';
            } finally {
                if (request === generation) setBusy(false);
            }
        });
        window.addEventListener('pagehide', () => {
            generation += 1;
            setBusy(false);
            status.textContent = '';
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
}());
