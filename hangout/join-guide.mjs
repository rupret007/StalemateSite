import { isSensitiveRequest } from './sw-policy.mjs';

const TRUSTED_HTTPS_HOSTS = new Set(['stalemate.band', 'jeffstory.github.io', 'rupret007.github.io']);

function trustedAssetBase(value, pageUrl) {
    let base;
    try {
        base = new URL(String(value || ''));
    } catch {
        return '';
    }
    if (base.username || base.password || base.search || base.hash) return '';
    if (!base.pathname.endsWith('/hangout/')) return '';
    if (/["'<>\s]/.test(base.href)) return '';
    if (pageUrl) {
        let page;
        try {
            page = pageUrl instanceof URL ? pageUrl : new URL(String(pageUrl));
        } catch {
            return '';
        }
        if (base.origin !== page.origin) return '';
        if (base.protocol !== 'https:' && base.protocol !== 'http:') return '';
        return base.href;
    }
    const loopback = base.hostname === 'localhost' || base.hostname === '127.0.0.1' || base.hostname === '[::1]';
    if (base.protocol === 'http:' && loopback) return base.href;
    if (base.protocol === 'https:' && TRUSTED_HTTPS_HOSTS.has(base.hostname)) return base.href;
    return '';
}

export function isJoinNavigation(url) {
    let path;
    try {
        path = (url instanceof URL ? url : new URL(String(url))).pathname;
    } catch {
        return false;
    }
    if (path.endsWith('/index.html')) path = path.slice(0, -'/index.html'.length);
    if (!path.endsWith('/')) path += '/';
    return path === '/join/' || path.endsWith('/join/');
}

export function shouldGuideJoin(url, request = {}) {
    if (isSensitiveRequest(url, request)) return false;
    const method = String(request.method || 'GET').toUpperCase();
    if (method !== 'GET') return false;
    if (request.mode && request.mode !== 'navigate') return false;
    return isJoinNavigation(url);
}

// The pinned join document has no slot for this module. A worker can insert
// the note only after it is already controlling the page.
export function injectJoinGuide(html, assetBase, pageUrl) {
    const base = trustedAssetBase(assetBase, pageUrl);
    if (typeof html !== 'string' || !base) return html;
    if (html.includes('hangout/open-in-app.mjs') || html.includes('name="hangout-open-in-app"')) return html;
    if (!html.includes('</head>')) return html;
    const tags = [
        '<meta name="hangout-open-in-app" content="always">',
        '<meta name="hangout-place" content="webjam">',
        `<link rel="stylesheet" href="${base}open-in-app.css">`,
        `<script type="module" src="${base}open-in-app.mjs"></script>`
    ].join('');
    return html.replace('</head>', `${tags}</head>`);
}
