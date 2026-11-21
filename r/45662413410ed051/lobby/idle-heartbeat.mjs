// Application keepalive, negotiated only with servers that meter transport controls.
// This never renews authentication or changes a room's activity/ownership.
export const LOBBY_IDLE_HEARTBEAT_MS = 5 * 60 * 1000;

export function createIdleHeartbeat(socket, isCurrent = () => true, now = () => performance.now()) {
    let timer, stopped = false, enabled = false, lastReceived = now();
    function stop() { stopped = true; clearTimeout(timer); timer = undefined; }
    function schedule() {
        clearTimeout(timer);
        if (enabled && !stopped) timer = setTimeout(tick, LOBBY_IDLE_HEARTBEAT_MS);
    }
    function tick() {
        if (!isCurrent() || socket.readyState !== 1) return stop();
        // Never add keepalives to an undrained browser queue or a busy room.
        if (now() - lastReceived >= LOBBY_IDLE_HEARTBEAT_MS && socket.bufferedAmount === 0) {
            try { socket.send(JSON.stringify({ t: 'transport-ping' })); }
            catch {
                stop();
                try { socket.close(4000, 'connection check unavailable'); } catch { /* Already gone. */ }
                return;
            }
        }
        schedule();
    }
    return {
        negotiate(version) {
            if (stopped) return;
            if (version !== 1) return stop();
            enabled = true; lastReceived = now(); schedule();
        },
        received() { lastReceived = now(); },
        stop
    };
}
