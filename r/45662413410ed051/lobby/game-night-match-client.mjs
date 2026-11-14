const requestErrors = { 401: 'sign-in', 403: 'room', 404: 'disabled', 429: 'rate-limited' };
const socketErrors = { 4403: 'room', 4409: 'replaced', 4429: 'rate-limited' };
const RECONNECT_CAP = 10_000;

export const matchConnectionErrors = Object.freeze({
    'sign-in': 'Sign in to the private beta again, then return to this room.',
    'replaced': 'This match is open in another tab. Continue there, or reload to play here.',
    'room': 'Return to your Game Night room and try again.',
    'disabled': 'This game is unavailable in this room right now.',
    'rate-limited': 'This match reached a connection or activity limit. Try again later.'
});

// Shown in place of "Waiting for the host" when the table has a game this person cannot see.
export const matchHiddenText = 'A game is under way at this table. You can’t see it right now.';

// A match connection can be replaced without changing room, chat or call.
export function createGameNightMatchClient({ prefix, onStatus, onState, onError, onMatch, onRematch }) {
    let shownMatch = null, rematchTimer;
    const tableId = window.HangoutBootstrap?.gameGuest?.tableId;
    const guestQuery = new URLSearchParams(location.search).get('game-guest') === '1'
        ? '?game-guest=1' + (tableId ? '&table=' + tableId : '') : '';
    let scope, socket, controller, reconnectTimer, joinTimer, claimTimer, generation = 0, failures = 0, ready = false;
    let pausedForNetwork = false, terminalError = false, lastSeq = 0, matchOpen = false;
    let hiddenAt, pongTimer, pingNonce = 0, supportsPing = false, waitingForPage = false;
    let playing = false, wakeLock, pendingWakeLock = false, retryWakeLock = false;
    async function updateWakeLock() {
        if (!playing || document.hidden) {
            const prior = wakeLock;
            wakeLock = null;
            if (prior) await prior.release().catch(() => {});
            return;
        }
        if (!navigator.wakeLock || wakeLock || pendingWakeLock) return;
        pendingWakeLock = true;
        try {
            const requested = await navigator.wakeLock.request('screen');
            if (!playing || document.hidden) await requested.release();
            else if (!requested.released) {
                wakeLock = requested;
                requested.addEventListener('release', () => {
                    if (wakeLock === requested) wakeLock = null;
                }, { once: true });
            }
        } catch { /* The browser can deny or lack screen wake locks. */ }
        finally {
            pendingWakeLock = false;
            if (retryWakeLock) {
                retryWakeLock = false;
                void updateWakeLock();
            }
        }
    }
    function setPlaying(active) {
        playing = active;
        void updateWakeLock();
    }
    function reset(reconnecting = false, failed = false) {
        generation++;
        waitingForPage = false;
        onMatch?.(scope, undefined, undefined, reconnecting, undefined, failed);
        clearTimeout(reconnectTimer);
        clearTimeout(joinTimer);
        clearTimeout(claimTimer);
        clearTimeout(pongTimer);
        clearTimeout(rematchTimer);
        controller?.abort();
        controller = null;
        const prior = socket;
        socket = null;
        if (prior && prior.readyState < WebSocket.CLOSING) prior.close(1000);
        ready = false;
        supportsPing = false;
    }
    function stop() {
        reset();
        scope = null;
        pausedForNetwork = false;
        hiddenAt = undefined;
        setPlaying(false);
    }
    function send(frame) {
        if (!ready || socket?.readyState !== WebSocket.OPEN) return false;
        try { socket.send(JSON.stringify({ version: 1, ...frame })); return true; }
        catch { socket.close(1000); return false; }
    }
    function retry(attempt, reason) {
        if (attempt !== generation || !scope) return;
        if (!reason && navigator.onLine === false) return pauseForNetwork();
        if (reason) {
            reset(false, true);
            terminalError = true;
            setPlaying(false);
            onStatus('unavailable', reason);
            return;
        }
        // An ordinary drop is never final: keep trying while the page is on screen.
        reset(true);
        onStatus('reconnecting');
        if (document.hidden) { waitingForPage = true; return; }
        const wait = Math.min(RECONNECT_CAP, 400 * 2 ** failures * (0.75 + Math.random() / 2));
        failures = Math.min(failures + 1, 8);
        reconnectTimer = setTimeout(connect, wait);
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
                    supportsPing = frame.ping === true;
                    ready = true;
                    let pass;
                    try { if (tableId) pass = localStorage.getItem('gn:pass:' + tableId); } catch { /* The session cookie can still admit this guest. */ }
                    send(stateFrameType === 'snapshot' ? { t: 'hello', lastSeq, ...(pass ? { pass } : {}) } : { action: 'sync' });
                } else if (stateFrameType && frame?.t === stateFrameType && frame.version === 1 && frame.room === scope.room) {
                    lastSeq = Number.isSafeInteger(frame.seq) ? frame.seq : 0;
                    clearTimeout(joinTimer);
                    failures = 0;
                    clearTimeout(claimTimer);
                    const wait = frame.state?.pendingGuestMs;
                    if (Number.isInteger(wait) && wait > 0 && wait <= 60000) {
                        claimTimer = setTimeout(() => send({ action: 'sync' }), wait);
                    }
                    const match = frame.state?.match;
                    shownMatch = frame.state?.id ?? frame.currentMatchId ?? null;
                    clearTimeout(rematchTimer);
                    // The server names a phase other than lobby when a game is open but hidden.
                    matchOpen = !frame.state && typeof frame.phase === 'string' && frame.phase !== 'lobby';
                    setPlaying(!!match && !!frame.state.seat && frame.phase !== 'finished' && !match.result);
                    onState(frame);
                    if (attempt === generation) onMatch?.(scope, frame.state, send, false,
                        stateFrameType === 'snapshot' ? frame : undefined);
                } else if (stateFrameType && frame?.t === 'rematch' && typeof frame.matchId === 'string'
                    && /^[a-zA-Z0-9-]{5,80}$/.test(frame.matchId) && frame.matchId !== shownMatch) {
                    // The new board normally follows at once. If it does not, ask for it.
                    onRematch?.(frame.matchId);
                    clearTimeout(rematchTimer);
                    rematchTimer = setTimeout(() => send({ action: 'sync' }), 1500);
                } else if (frame?.t === 'pong' && frame.nonce === pingNonce) clearTimeout(pongTimer);
                else if (frame?.t === 'match-error') onError(frame.reason);
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
        if (!scope || terminalError || pausedForNetwork || controller || (socket && !ready)) return;
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
    document.addEventListener('visibilitychange', () => {
        if (pendingWakeLock && !document.hidden) retryWakeLock = true;
        void updateWakeLock();
        if (document.hidden) { hiddenAt = Date.now(); return; }
        const away = hiddenAt === undefined ? 0 : Date.now() - hiddenAt;
        hiddenAt = undefined;
        // A drop while the page was hidden waited here instead of spending retries.
        if (waitingForPage) return reconnect();
        if (!scope || away <= 5000 || terminalError || pausedForNetwork || controller || !ready && socket) return;
        clearTimeout(pongTimer);
        if (!supportsPing || !send({ action: 'ping', nonce: ++pingNonce })) return reconnect();
        pongTimer = setTimeout(reconnect, 1500);
    });
    return {
        start(next) { stop(); scope = next; terminalError = false; failures = 0; lastSeq = 0; matchOpen = false; shownMatch = null; void connect(); },
        stop,
        matchOpen: () => matchOpen,
        send
    };
}
