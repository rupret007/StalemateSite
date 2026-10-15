/* Configurable public base path. Works under /StalemateSite/ on GitHub Pages
   and at a custom-domain root later. See README for the CNAME switch. */
(function initializeStalemateSite(global) {
    'use strict';

    const PROJECT_BASE = '/StalemateSite/';
    const PUBLIC_ORIGIN = 'https://rupret007.github.io';

    function normalizeBase(value) {
        if (value === '/' || value === '' || value == null) return '/';
        let base = String(value);
        if (!base.startsWith('/')) base = `/${base}`;
        if (!base.endsWith('/')) base += '/';
        return base;
    }

    function detectBase(pathname) {
        const configured = normalizeBase(PROJECT_BASE);
        const path = pathname || '/';
        if (configured !== '/' && (path === configured.slice(0, -1) || path.startsWith(configured))) {
            return configured;
        }
        return '/';
    }

    function join(base, relativePath) {
        const prefix = normalizeBase(base);
        const leaf = String(relativePath || '').replace(/^\//, '');
        return prefix === '/' ? `/${leaf}` : `${prefix}${leaf}`;
    }

    function publicUrl() {
        return `${PUBLIC_ORIGIN}${normalizeBase(PROJECT_BASE)}`;
    }

    const api = Object.freeze({
        PROJECT_BASE,
        PUBLIC_ORIGIN,
        normalizeBase,
        detectBase,
        join,
        publicUrl,
        currentBase() {
            return detectBase(global.location && global.location.pathname);
        }
    });

    global.StalemateSite = api;
}(typeof globalThis === 'undefined' ? window : globalThis));
