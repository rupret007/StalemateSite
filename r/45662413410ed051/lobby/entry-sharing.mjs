import { ENTRY_SITES, normalizeEntrySource } from '../entry-sites.mjs';

// A choice can change while the socket handshake is still in flight. Reconcile
// it before allowing the connected UI to send new messages. Enqueuing a socket
// frame is not server confirmation. Keep only one unacknowledged change, with
// no timers, storage, account identity or authority in display context.
export function createEntrySharing({ source, enabled = true, registry = ENTRY_SITES, send, onChange = () => {} }) {
    const entrySource = normalizeEntrySource(source, registry);
    let sharing = enabled === true;
    let connected = false;
    let supported = false;
    let acknowledged = null;
    let pending = null;
    let rejected = false;
    const desired = () => sharing ? entrySource : '';
    const snapshot = () => ({ source: acknowledged, requested: desired(),
        state: !connected ? 'offline' : !supported ? 'unavailable' : rejected ? 'rejected'
            : pending || acknowledged !== desired() ? 'pending' : 'confirmed' });
    const changed = () => onChange(snapshot());
    const reconcile = () => {
        if (!connected || !supported || pending || rejected || acknowledged === desired()) return;
        // Set before send so an in-process adapter can acknowledge synchronously.
        const request = { source: desired() };
        pending = request;
        if (send({ t: 'entry-source', source: request.source }) !== true && pending === request) {
            pending = null; rejected = true;
        }
    };
    return {
        helloSource() { connected = false; pending = null; rejected = false; acknowledged = desired(); changed(); return acknowledged; },
        setSupported(value) { supported = value === true; reconcile(); changed(); },
        joined() { connected = true; rejected = false; reconcile(); changed(); },
        setEnabled(value) { sharing = value === true; rejected = false; reconcile(); changed(); },
        acknowledge(frame) {
            if (!connected || !supported || !pending || typeof frame?.source !== 'string'
                || normalizeEntrySource(frame.source, registry) !== frame.source) return;
            const expected = pending.source;
            pending = null; acknowledged = frame.source;
            // Earlier version-one servers omit accepted on a successful update.
            rejected = (frame.accepted === false || frame.source !== expected) && acknowledged !== desired();
            reconcile(); changed();
        },
        canSend() { return !connected || !supported || sharing || acknowledged === '' && !pending?.source; },
        snapshot,
        disconnect() { connected = false; supported = false; acknowledged = null; pending = null; rejected = false; changed(); }
    };
}
