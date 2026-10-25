// One persisted request unit conservatively prepays 20 incoming WebSocket
// controls (Cloudflare compute-request billing 20:1). Not a new allowance pool.
export const TRANSPORT_CONTROL_BLOCK = 20;
const utcDay = now => new Date(now).toISOString().slice(0, 10);
const validDay = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
    && Number.isFinite(Date.parse(`${day}T00:00:00Z`)) && utcDay(Date.parse(`${day}T00:00:00Z`)) === day;

// The caller serializes this alongside application work. A grant is tied to its
// current socket, never a browser claim, nickname, reusable token or refund.
export function createTransportControlBudget({ reserve, available = () => true, readState, writeState, now = () => Date.now() }) {
    const saved = new WeakMap();
    const read = readState || (ws => saved.get(ws));
    const write = writeState || ((ws, state) => saved.set(ws, state));
    const stats = { reservations: 0, prepaidControls: 0, consumedControls: 0, refused: 0 };
    return {
        async take(ws, connection) {
            try {
                if (!available(connection)) { stats.refused += 1; return false; }
                const day = utcDay(now());
                let grant = read(ws);
                if (grant !== undefined && (!grant || grant.v !== 1 || !validDay(grant.day)
                    || !Number.isSafeInteger(grant.remaining) || grant.remaining < 0 || grant.remaining >= TRANSPORT_CONTROL_BLOCK
                    || grant.day > day)) { stats.refused += 1; return false; }
                if (!grant || grant.day !== day || grant.remaining === 0) {
                    const result = await reserve(connection);
                    if (result?.ok && validDay(result.day) && result.controls === TRANSPORT_CONTROL_BLOCK) {
                        stats.reservations += 1; stats.prepaidControls += TRANSPORT_CONTROL_BLOCK;
                    }
                    // A midnight crossed during persistence must not spend yesterday's
                    // reservation in today's connection budget.
                    if (!result?.ok || result.day !== day || result.day !== utcDay(now()) || result.controls !== TRANSPORT_CONTROL_BLOCK) {
                        stats.refused += 1; return false;
                    }
                    grant = { v: 1, day, remaining: TRANSPORT_CONTROL_BLOCK };
                }
                write(ws, { v: 1, day, remaining: grant.remaining - 1 });
                stats.consumedControls += 1;
                return true;
            } catch { stats.refused += 1; return false; }
        },
        snapshot: () => ({ ...stats })
    };
}
