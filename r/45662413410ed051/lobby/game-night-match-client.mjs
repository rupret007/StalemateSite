const requestErrors = { 401: 'sign-in', 403: 'room', 404: 'disabled', 429: 'rate-limited' };
const socketErrors = { 4403: 'room', 4409: 'replaced', 4429: 'rate-limited' };

export const matchConnectionErrors = Object.freeze({
    'sign-in': 'Sign in to the private beta again, then return to this room.',
    'room': 'Return to your Game Night room and try again.',
    'replaced': 'This match is open in another tab. Continue there, or reload to play here.',
    'disabled': 'This game is unavailable in this room right now.',
    'rate-limited': 'This match reached a connection or activity limit. Try again later.'
});

// A match connection can be replaced without changing room, chat or call.
export function createGameNightMatchClient({ prefix, onStatus, onState, onError, onMatch }) {
    const guestQuery = new URLSearchParams(location.search).get('game-guest') === '1' ? '?game-guest=1' : '';
    let scope, socket, controller, reconnectTimer, joinTimer, claimTimer, generation = 0, failures = 0, ready = false;
    let pausedForNetwork = false, terminalError = false, lastSeq = 0;
    function reset(reconnecting = false) {
        generation++;
        onMatch?.(scope, undefined, undefined, reconnecting);
        clearTimeout(reconnectTimer);
        clearTimeout(joinTimer);
        clearTimeout(claimTimer);
        controller?.abort();
        controller = null;
        const prior = socket;
        socket = null;
        if (prior && prior.readyState < WebSocket.CLOSING) prior.close(1000);
        ready = false;
    }
    function stop() { reset(); scope = null; pausedForNetwork = false; }
    function send(frame) {
        if (!ready || socket?.readyState !== WebSocket.OPEN) return false;
        try { socket.send(JSON.stringify({ version: 1, ...frame })); return true; }
        catch { socket.close(1000); return false; }
    }
    function retry(attempt, reason) {
        if (attempt !== generation || !scope) return;
        if (!reason && navigator.onLine === false) return pauseForNetwork();
        if (reason || failures >= 3) {
            reset();
            terminalError = !!reason;
            onStatus('unavailable', reason);
            return;
        }
        reset(true);
        onStatus('reconnecting');
        reconnectTimer = setTimeout(connect, 400 * 2 ** failures++ * (0.75 + Math.random() / 2));
    }
    async function connect() {
        if (!scope || controller || socket) return;
        if (navigator.onLine === false) return pauseForNetwork();
        const attempt = ++generation;
        const request = new AbortController();
        controller = request;
        onStatus(failures ? 'reconnecting' : 'connecting');
        joinTimer = setTimeout(() => retry(attempt), 8000);
        try {
            const response = await fetch(prefix + '-ticket' + guestQuery, {
                method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(scope), signal: request.signal
            });
            if (attempt !== generation) return;
            if (!response.ok) { retry(attempt, requestErrors[response.status]); return; }
            const grant = await response.json();
            if (attempt !== generation) return;
            if (!/^m[a-f0-9]{32}$/.test(grant.ticket) || grant.protocol !== 'game-night.v1') throw Error('Invalid match grant');
            const url = new URL(prefix + '-match' + guestQuery, location.href);
            url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            const connection = new WebSocket(url, [grant.protocol, grant.ticket]);
            socket = connection;
            let stateFrameType;
            connection.addEventListener('close', event => retry(attempt, socketErrors[event.code]));
            connection.addEventListener('message', event => {
                if (attempt !== generation) return;
                let frame;
                try { frame = JSON.parse(event.data); } catch { return; }
                if (frame?.t === 'match-ready' && frame.version === 1) {
                    if (stateFrameType) return;
                    stateFrameType = frame.snapshots === true ? 'snapshot' : 'match-state';
                    ready = true;
                    send(stateFrameType === 'snapshot' ? { t: 'hello', lastSeq } : { action: 'sync' });
                } else if (stateFrameType && frame?.t === stateFrameType && frame.version === 1 && frame.room === scope.room) {
                    lastSeq = Number.isSafeInteger(frame.seq) ? frame.seq : 0;
                    clearTimeout(joinTimer);
                    failures = 0;
                    clearTimeout(claimTimer);
                    const wait = frame.state?.pendingGuestMs;
                    if (Number.isInteger(wait) && wait > 0 && wait <= 60000) {
                        claimTimer = setTimeout(() => send({ action: 'sync' }), wait);
                    }
                    onState(frame);
                    if (attempt === generation) onMatch?.(scope, frame.state, send, false,
                        stateFrameType === 'snapshot' ? frame : undefined);
                } else if (frame?.t === 'match-error') onError(frame.reason);
            });
        } catch {
            retry(attempt);
        } finally {
            if (controller === request) controller = null;
        }
    }
    function pauseForNetwork() {
        if (!scope || terminalError || pausedForNetwork) return;
        pausedForNetwork = true;
        reset(true);
        onStatus('reconnecting');
    }
    function reconnect() {
        if (!scope || terminalError || pausedForNetwork) return;
        failures = 1;
        reset(true);
        void connect();
    }
    window.addEventListener('offline', pauseForNetwork);
    window.addEventListener('online', () => {
        if (!pausedForNetwork) return;
        pausedForNetwork = false;
        reconnect();
    });
    window.addEventListener('pageshow', event => {
        if (event.persisted) reconnect();
    });
    return {
        start(next) { stop(); scope = next; terminalError = false; failures = 0; lastSeq = 0; void connect(); },
        stop,
        send
    };
}
