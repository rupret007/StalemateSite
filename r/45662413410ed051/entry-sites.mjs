// Public display context, never authentication, band membership or a permission.
// Additional sites come only from reviewed application configuration, not links.
export const DEFAULT_ENTRY_SITES = Object.freeze([
    Object.freeze({ id: 'stalemate', label: 'Stalemate', home: 'https://stalemate.band/' }),
    Object.freeze({ id: 'rad-dad', label: 'Rad Dad', home: 'https://raddadband.com/' })
]);
const ID = /^[a-z][a-z0-9-]{0,31}$/;
const validLabel = (value) => typeof value === 'string' && value.length >= 1 && value.length <= 40
    && value === value.trim() && !/[\u0000-\u001f\u007f<>]/.test(value);
function safeHome(value) {
    if (typeof value !== 'string' || value.length > 2000) return '';
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash ? url.href : '';
    } catch { return ''; }
}

export function createEntrySiteRegistry(additional = []) {
    const registry = Object.create(null);
    for (const site of DEFAULT_ENTRY_SITES) registry[site.id] = site;
    if (Array.isArray(additional) && additional.length <= 30) {
        for (const site of additional) {
            if (!site || typeof site !== 'object' || Array.isArray(site) || typeof site.id !== 'string' || !ID.test(site.id)
                || !validLabel(site.label) || Object.hasOwn(registry, site.id)) continue;
            const home = safeHome(site.home);
            registry[site.id] = Object.freeze({ id: site.id, label: site.label, ...(home ? { home } : {}) });
        }
    }
    return Object.freeze(registry);
}
export const ENTRY_SITES = createEntrySiteRegistry();

export function entrySitesFromConfig(raw) {
    if (typeof raw !== 'string' || raw.length > 8192) return ENTRY_SITES;
    try { return createEntrySiteRegistry(JSON.parse(raw)); } catch { return ENTRY_SITES; }
}
export function normalizeEntrySource(value, registry = ENTRY_SITES) {
    return typeof value === 'string' && ID.test(value) && Object.hasOwn(registry, value) ? value : '';
}
export function entryBadge(value, registry = ENTRY_SITES) {
    const id = normalizeEntrySource(value, registry);
    return id ? `via ${registry[id].label}` : '';
}
export function entryReturn(value, registry = ENTRY_SITES) {
    const id = normalizeEntrySource(value, registry);
    return id && registry[id].home ? { href: registry[id].home, label: `Back to ${registry[id].label}` } : null;
}
export function entrySourceFromParams(params, registry = ENTRY_SITES) {
    const values = params.getAll('via');
    return values.length === 1 ? normalizeEntrySource(values[0], registry) : '';
}

// A short-lived, one-use tab handoff carries a choice through a real sign-in
// navigation. It does not mark future direct visits or cross-tab browsing.
export const ENTRY_HANDOFF_KEY = 'hangout-entry-handoff';
export function entryHandoff(source, share, now = Date.now(), registry = ENTRY_SITES) {
    return JSON.stringify({ v: 1, source: normalizeEntrySource(source, registry), share: share === true, at: now });
}
export function readEntryHandoff(raw, now = Date.now(), registry = ENTRY_SITES) {
    if (typeof raw !== 'string' || raw.length > 256) return null;
    try {
        const value = JSON.parse(raw);
        if (value?.v !== 1 || typeof value.share !== 'boolean' || !Number.isFinite(value.at)
            || value.at > now || now - value.at >= 10 * 60 * 1000) return null;
        const source = normalizeEntrySource(value.source, registry);
        return source ? { source, share: value.share } : null;
    } catch { return null; }
}
