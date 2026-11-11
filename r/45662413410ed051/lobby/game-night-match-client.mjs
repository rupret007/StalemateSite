// A match connection can be replaced without changing room, chat or call.
export function createGameNightMatchClient({ prefix, onStatus, onState, onError }) {
    let scope, socket, controller, reconnectTimer, joinTimer, generation = 0, failures = 0, ready = false;
    function reset() {
        generation++;
        clearTimeout(reconnectTimer);
        clearTimeout(joinTimer);
        controller?.abort();
        controller = null;
        const prior = socket;
        socket = null;
        if (prior && prior.readyState < WebSocket.CLOSING) prior.close(1000);
        ready = false;
    }
    function stop() { scope = null; reset(); }
    function send(frame) {
        if (!ready || socket?.readyState !== WebSocket.OPEN) return false;
        try { socket.send(JSON.stringify({ version: 1, ...frame })); return true; }
        catch { socket.close(1000); return false; }
    }
    function retry(attempt, terminal = false) {
        if (attempt !== generation || !scope) return;
        reset();
        if (terminal || failures >= 3) {
            onStatus('unavailable');
            return;
        }
        onStatus('reconnecting');
        reconnectTimer = setTimeout(connect, 400 * 2 ** failures++);
    }
    async function connect() {
        if (!scope || controller || socket) return;
        const attempt = ++generation;
        const request = new AbortController();
        controller = request;
        onStatus('connecting');
        joinTimer = setTimeout(() => retry(attempt), 8000);
        try {
            const response = await fetch(prefix + '-ticket', {
                method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(scope), signal: request.signal
            });
            if (attempt !== generation) return;
            if (!response.ok) { retry(attempt, [401, 403, 404, 429].includes(response.status)); return; }
            const grant = await response.json();
            if (attempt !== generation) return;
            if (!/^m[a-f0-9]{32}$/.test(grant.ticket) || grant.protocol !== 'game-night.v1') throw Error('Invalid match grant');
            const url = new URL(prefix + '-match', location.href);
            url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            const connection = new WebSocket(url, [grant.protocol, grant.ticket]);
            socket = connection;
            connection.addEventListener('close', event => retry(attempt, [4403, 4409, 4429].includes(event.code)));
            connection.addEventListener('message', event => {
                if (attempt !== generation) return;
                let frame;
                try { frame = JSON.parse(event.data); } catch { return; }
                if (frame?.t === 'match-ready' && frame.version === 1) {
                    ready = true;
                    send({ action: 'sync' });
                } else if (frame?.t === 'match-state' && frame.version === 1 && frame.room === scope.room) {
                    clearTimeout(joinTimer);
                    failures = 0;
                    onState(frame);
                } else if (frame?.t === 'match-error') onError(frame.reason);
            });
        } catch {
            retry(attempt);
        } finally {
            if (controller === request) controller = null;
        }
    }
    return {
        start(next) { reset(); scope = next; failures = 0; void connect(); },
        stop,
        send
    };
}
