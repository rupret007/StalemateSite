// Trusted, reviewed public configuration, kept with the private application.
// This is not an authentication API and never establishes domain ownership.
import { DEFAULT_ENTRY_SITES, createEntrySiteRegistry, normalizeEntrySource } from '../../r/45662413410ed051/entry-sites.mjs';
export { createEntrySiteRegistry };

const RIGHTS = new Set(['link', 'badge', 'return']);
const MAX_SITES = 32;
const exactKeys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((key) => allowed.includes(key));
const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function publicUrl(raw, { allowLoopback = false } = {}) {
    if (typeof raw !== 'string' || raw.length > 2048 || raw !== raw.trim()) throw new Error('Expected a bounded public URL.');
    let url;
    try { url = new URL(raw); } catch { throw new Error('Expected an absolute public URL.'); }
    const local = allowLoopback && url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.hostname.includes('*'))
        throw new Error('Public URLs require HTTPS, without credentials, queries or fragments.');
    return url;
}

export function communityIntegration(config, options = {}) {
    if (!exactKeys(config, ['version', 'communityAddress', 'sites']) || config.version !== 1
        || !Array.isArray(config.sites) || config.sites.length < 1 || config.sites.length > MAX_SITES)
        throw new Error('Expected a version 1 community integration with 1–32 reviewed sites.');
    const community = publicUrl(config.communityAddress, options);
    if (!community.pathname.endsWith('/')) throw new Error('The community entry address must end with /.');
    const ids = new Set();
    const sites = config.sites.map((site) => {
        if (!exactKeys(site, ['id', 'label', 'origins', 'returnUrl', 'permissions', 'enabled', 'domainVerified'])
            || typeof site.id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(site.id) || ids.has(site.id)
            || typeof site.label !== 'string' || !site.label || site.label.length > 40 || site.label !== site.label.trim()
            || /[\u0000-\u001f\u007f<>]/.test(site.label)
            || typeof site.enabled !== 'boolean' || typeof site.domainVerified !== 'boolean'
            || !Array.isArray(site.permissions) || !site.permissions.length || site.permissions.length > RIGHTS.size
            || new Set(site.permissions).size !== site.permissions.length || site.permissions.some((right) => !RIGHTS.has(right))
            || !site.permissions.includes('link') || !Array.isArray(site.origins) || !site.origins.length || site.origins.length > 8)
            throw new Error('Invalid or duplicate registered site. Only link, badge and return permissions are supported.');
        const builtin = DEFAULT_ENTRY_SITES.find((entry) => entry.id === site.id);
        if (builtin && builtin.label !== site.label) throw new Error('Built-in site labels cannot be replaced.');
        if (site.permissions.includes('return') && !site.permissions.includes('badge'))
            throw new Error('Return navigation requires entry-source context through the badge permission.');
        if (builtin && site.permissions.includes('badge') && !site.permissions.includes('return'))
            throw new Error('Built-in badge entries include their canonical return navigation.');
        if (site.enabled && !site.domainVerified) throw new Error('An enabled integration needs operator-confirmed domain verification.');
        ids.add(site.id);
        const origins = site.origins.map((raw) => {
            const origin = publicUrl(raw, options);
            if (origin.pathname !== '/') throw new Error('Registered origins cannot include paths.');
            return origin.origin;
        });
        if (new Set(origins).size !== origins.length) throw new Error('Registered origins must be distinct.');
        if (builtin?.home && !origins.includes(new URL(builtin.home).origin))
            throw new Error('Built-in sites must retain their canonical origin.');
        let returnUrl = '';
        if (site.permissions.includes('return')) {
            const target = publicUrl(site.returnUrl, options);
            if (!origins.includes(target.origin)) throw new Error('Return navigation must stay on a registered origin.');
            returnUrl = target.href;
            if (builtin?.home && returnUrl !== builtin.home) throw new Error('Built-in return navigation cannot be replaced.');
        } else if (site.returnUrl !== undefined && site.returnUrl !== '') throw new Error('Return navigation is not permitted.');
        return Object.freeze({ id: site.id, label: site.label, origins: Object.freeze(origins), returnUrl,
            permissions: Object.freeze([...site.permissions]), enabled: site.enabled, domainVerified: site.domainVerified });
    });
    const additional = sites.filter((site) => site.enabled && site.permissions.includes('badge')
        && !DEFAULT_ENTRY_SITES.some((entry) => entry.id === site.id)).map(({ id, label, returnUrl }) => ({ id, label, ...(returnUrl ? { home: returnUrl } : {}) }));
    if (additional.length > 30) throw new Error('At most 30 additional badge sites are supported.');
    return Object.freeze({ version: 1, communityAddress: community.href, sites: Object.freeze(sites),
        entrySites: createEntrySiteRegistry(additional) });
}

export function communityJoinLink(integration, siteId) {
    const site = integration.sites.find((entry) => entry.id === siteId);
    if (!site || !site.enabled || !site.domainVerified) throw new Error('This site integration is not enabled.');
    const url = new URL(integration.communityAddress);
    const source = site.permissions.includes('badge') ? normalizeEntrySource(site.id, integration.entrySites) : '';
    if (source) url.searchParams.set('via', source);
    return Object.freeze({ href: url.href, label: 'Hang Out', source, returnUrl: site.returnUrl,
        disclosure: source ? `Opens our shared community. You can show “via ${site.label}” beside your nickname or hide it.` : 'Opens our shared community.' });
}

export function communityLinkHtml(integration, siteId) {
    const link = communityJoinLink(integration, siteId);
    return `<a href="${escape(link.href)}" referrerpolicy="no-referrer">${escape(link.label)}</a>\n<small>${escape(link.disclosure)}</small>\n`;
}

export function communityPublicManifest(integration) {
    return { version: 1, communityAddress: integration.communityAddress, sites: integration.sites,
        entrySites: Object.values(integration.entrySites).filter((site) => !DEFAULT_ENTRY_SITES.some((builtin) => builtin.id === site.id)) };
}
