import { ENTRY_SITES, normalizeEntrySource } from '../entry-sites.mjs';

// A choice can change while the socket handshake is still in flight. Reconcile
// it before allowing the connected UI to send new messages. No timers, storage,
// account identity or authority are involved in sharing display context.
export function createEntrySharing({ source, enabled = true, registry = ENTRY_SITES, send }) {
    const entrySource = normalizeEntrySource(source, registry);
    let sharing = enabled === true;
    let connected = false;
    let supported = false;
    let advertised = null;
    const desired = () => sharing ? entrySource : '';
    const reconcile = () => {
        if (!connected || !supported || advertised === desired()) return;
        const value = desired();
        if (send({ t: 'entry-source', source: value }) === true) advertised = value;
    };
    return {
        helloSource() { connected = false; advertised = desired(); return advertised; },
        setSupported(value) { supported = value === true; reconcile(); },
        joined() { connected = true; reconcile(); },
        setEnabled(value) { sharing = value === true; reconcile(); },
        disconnect() { connected = false; supported = false; advertised = null; }
    };
}
