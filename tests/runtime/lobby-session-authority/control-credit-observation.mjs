// Pure test-only observation of actual transport-credit calls. Never grants,
// persists, reads the clock or exports a connection identifier.
const BLOCK = 20;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const dayValid = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
    && Number.isFinite(Date.parse(day + 'T00:00:00Z')) && new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day;
const data = (value, keys) => !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) || {}, 'value'));
const grantValid = grant => data(grant, ['v', 'day', 'remaining']) && grant.v === 1 && dayValid(grant.day)
    && integer(grant.remaining) && grant.remaining < BLOCK;
const sameGrant = (a, b) => a === undefined && b === undefined || !!a && !!b && a.v === b.v && a.day === b.day && a.remaining === b.remaining;

export function createControlCreditObservation({ maxConnections = 50, maxDays = 2 } = {}) {
    if (!Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 50
        || !Number.isInteger(maxDays) || maxDays < 1 || maxDays > 2) throw TypeError('Invalid bounded credit observation limits');
    const connections = new Map(); let invalid = false, overflow = false;
    const bad = () => { invalid = true; };
    function connection(id) {
        if (typeof id !== 'string' || !id || id.length > 128) { bad(); return null; }
        if (!connections.has(id)) {
            if (connections.size >= maxConnections) { overflow = true; return null; }
            connections.set(id, { days: new Map(), initialized: false, grant: undefined });
        }
        return connections.get(id);
    }
    function row(c, day) {
        if (!dayValid(day)) { bad(); return null; }
        if (!c.days.has(day)) {
            if (c.days.size >= maxDays) { overflow = true; return null; }
            c.days.set(day, { day, reservations: 0, controls: 0, openingControls: 0,
                discardedControls: 0, remainingControls: 0, unassignedControls: 0 });
        }
        return c.days.get(day);
    }
    function add(r, field, amount) {
        if (!integer(amount) || !integer(r[field] + amount)) { overflow = true; return false; }
        r[field] += amount; return true;
    }
    function before(c, grant) {
        if (grant !== undefined && !grantValid(grant)) { bad(); return false; }
        if (!c.initialized) {
            if (grant) {
                const r = row(c, grant.day); if (!r) return false;
                // A first-seen imported grant contributes only its actual
                // unspent opening credit, not invented prior reservations.
                add(r, 'openingControls', grant.remaining); add(r, 'remainingControls', grant.remaining);
            }
            c.grant = grant && { ...grant }; c.initialized = true;
        }
        if (!sameGrant(c.grant, grant)) { bad(); return false; }
        return true;
    }
    return Object.freeze({
        reservation(id, result) {
            try {
                if (!result || typeof result !== 'object') return;
                const ok = Object.getOwnPropertyDescriptor(result, 'ok');
                if (ok && !Object.hasOwn(ok, 'value')) { bad(); return; }
                if (ok?.value !== true) return;
                const c = connection(id); if (!c) return;
                if (!data(result, ['ok', 'day', 'controls']) || !dayValid(result.day) || result.controls !== BLOCK) { bad(); return; }
                const r = row(c, result.day); if (!r) return;
                add(r, 'reservations', 1); add(r, 'unassignedControls', BLOCK);
            } catch { bad(); } // An observer failure never replaces a real call.
        },
        consumption(id, beforeGrant, afterGrant, accepted) {
            try {
                const c = connection(id); if (!c || !before(c, beforeGrant)) return;
                if (typeof accepted !== 'boolean' || afterGrant !== undefined && !grantValid(afterGrant)) { bad(); return; }
                if (!accepted) { if (!sameGrant(beforeGrant, afterGrant)) bad(); return; }
                if (!afterGrant || beforeGrant && afterGrant.day < beforeGrant.day) { bad(); return; }
                const next = row(c, afterGrant.day); if (!next) return;
                const newBlock = !beforeGrant || beforeGrant.day !== afterGrant.day || beforeGrant.remaining === 0;
                if (newBlock) {
                    if (next.unassignedControls < BLOCK || afterGrant.remaining !== BLOCK - 1) { bad(); return; }
                    if (beforeGrant && beforeGrant.day !== afterGrant.day) {
                        const prior = row(c, beforeGrant.day); if (!prior || prior.remainingControls !== beforeGrant.remaining) { bad(); return; }
                        add(prior, 'discardedControls', beforeGrant.remaining); prior.remainingControls = 0;
                    }
                    next.unassignedControls -= BLOCK;
                } else if (beforeGrant.remaining - 1 !== afterGrant.remaining || next.remainingControls !== beforeGrant.remaining) { bad(); return; }
                add(next, 'controls', 1); next.remainingControls = afterGrant.remaining; c.grant = { ...afterGrant };
            } catch { bad(); }
        },
        snapshot(id, currentGrant) {
            try {
                const c = connection(id); if (c) before(c, currentGrant);
                return { days: c ? [...c.days.values()].sort((a, b) => a.day.localeCompare(b.day)).map(r => ({ ...r })) : [], invalid, overflow };
            } catch { bad(); return { days: [], invalid, overflow }; }
        }
    });
}
