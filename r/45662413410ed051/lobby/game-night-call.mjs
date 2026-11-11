import { openGameNightPeer } from './game-night-peer.mjs';

const protocol = 'game-night-media.v1';
const off = () => ({ audio: false, video: false });
const types = ['audio', 'video'];
const device = { audio: 'microphone', video: 'camera' };

export function mountGameNightCall(container, toggle, { personActions }) {
    const document = container.ownerDocument;
    const $ = selector => container.querySelector(selector);
    const join = $('[data-call-join]'), leave = $('[data-call-leave]');
    const status = $('[data-call-status]'), peersHost = $('[data-call-peers]');
    const adult = $('[data-call-adult]'), cameraPolicy = $('[data-call-policy]');
    const buttons = { audio: $('[data-call-mic]'), video: $('[data-call-camera]') };
    const peers = new Map(), tracks = new Map();
    let scope = null, socket = null, request = null, timer, joined = false;
    let allowed = off(), canUseCamera = false, canManageCamera = false, pending = null;
    const supported = !!(navigator.mediaDevices?.getUserMedia && window.RTCPeerConnection);
    let notice = '';

    function draw() {
        toggle.hidden = !scope;
        toggle.textContent = joined ? 'Call joined' : 'Call';
        toggle.setAttribute('aria-expanded', String(!container.hidden));
        status.textContent = notice || (joined ? 'You’re in the call.' : 'Your mic and camera start off.');
        join.hidden = joined;
        join.disabled = !!request || !!socket || !supported;
        leave.hidden = !joined && !request && !socket;
        cameraPolicy.hidden = !joined || !canManageCamera;
        adult.closest('label').hidden = !joined || !canUseCamera || !!tracks.get('video');
        for (const kind of types) {
            const live = !!tracks.get(kind);
            const button = buttons[kind];
            button.hidden = !joined || kind === 'video' && !canUseCamera;
            button.disabled = !live && (!!pending || kind === 'video' && !adult.checked);
            button.setAttribute('aria-pressed', String(live));
            button.textContent = live ? (kind === 'audio' ? 'Mute mic' : 'Turn camera off')
                : pending?.kind === kind ? 'Starting…' : (kind === 'audio' ? 'Unmute mic' : 'Turn camera on');
        }
    }

    function send(action, details) {
        if (socket?.readyState !== WebSocket.OPEN) return false;
        try { socket.send(JSON.stringify({ version: 1, action, ...details })); return true; }
        catch { return false; }
    }

    function detachTrack(kind) {
        tracks.get(kind)?.stop();
        tracks.delete(kind);
        for (const peer of peers.values()) peer.link.setTrack(kind, null);
    }

    function closePeer(id) {
        const peer = peers.get(id);
        if (!peer) return;
        peers.delete(id);
        peer.link.close();
        for (const media of [peer.audio, peer.video]) media.srcObject = null;
        peer.row.remove();
    }

    function stop(message = '') {
        clearTimeout(timer);
        clearTimeout(pending?.timer);
        pending = null;
        request?.abort(); request = null;
        const prior = socket;
        socket = null;
        if (prior && prior.readyState < WebSocket.CLOSING) prior.close(1000);
        for (const id of peers.keys()) closePeer(id);
        for (const kind of types) detachTrack(kind);
        allowed = off();
        adult.checked = false;
        canUseCamera = canManageCamera = joined = false;
        notice = message;
        draw();
    }

    function changeTracks(kind, on) {
        const next = Object.fromEntries(types.map(type => [type, type === kind ? on : !!tracks.get(type)]));
        if (!send('tracks', { ...next, adult18: adult.checked || !!tracks.get('video') })) {
            stop('Call disconnected. Join again when you’re ready.');
            return false;
        }
        return true;
    }

    function disable(kind) {
        if (pending) {
            clearTimeout(pending.timer);
            pending = null;
        }
        detachTrack(kind);
        changeTracks(kind, false);
        draw();
    }

    async function capture(attempt) {
        attempt.started = true;
        clearTimeout(attempt.timer);
        try {
            const stream = await navigator.mediaDevices.getUserMedia(attempt.kind === 'audio'
                ? { audio: { echoCancellation: true, noiseSuppression: true }, video: false }
                : { audio: false, video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 270 }, frameRate: { ideal: 15, max: 24 } } });
            const [track] = stream.getTracks();
            if (pending !== attempt || !allowed[attempt.kind]) {
                for (const stale of stream.getTracks()) stale.stop();
                return;
            }
            if (!track || track.kind !== attempt.kind || track.readyState !== 'live') {
                for (const invalid of stream.getTracks()) invalid.stop();
                throw Error('Device did not start');
            }
            pending = null;
            tracks.set(attempt.kind, track);
            for (const peer of peers.values()) peer.link.setTrack(attempt.kind, track);
            track.addEventListener('ended', () => {
                if (tracks.get(attempt.kind) !== track) return;
                notice = `Your ${device[attempt.kind]} stopped.`;
                disable(attempt.kind);
            }, { once: true });
            notice = '';
        } catch {
            if (pending !== attempt) return;
            notice = `Couldn’t start your ${device[attempt.kind]}. Check browser permissions and try again.`;
            disable(attempt.kind);
        }
        draw();
    }

    function switchTrack(kind) {
        if (!joined) return;
        if (tracks.has(kind)) {
            notice = '';
            disable(kind);
            return;
        }
        if (pending || kind === 'video' && (!canUseCamera || !adult.checked)) return;
        const attempt = { kind, started: false };
        pending = attempt;
        notice = `Waiting for ${device[kind]} permission…`;
        if (!changeTracks(kind, true)) return;
        attempt.timer = setTimeout(() => {
            if (pending !== attempt) return;
            notice = 'The device request timed out. Try again.';
            disable(kind);
        }, 8000);
        draw();
    }

    function addPeer({ id, nick }) {
        const row = document.createElement('li'), name = document.createElement('button');
        const video = document.createElement('video'), audio = document.createElement('audio');
        const play = document.createElement('button'), devices = document.createElement('span');
        name.type = play.type = 'button';
        name.className = play.className = 'btn btn--small btn--ghost';
        name.textContent = nick;
        name.setAttribute('aria-label', `Actions for ${nick}`);
        name.addEventListener('click', () => personActions(id));
        play.textContent = 'Play call audio';
        play.hidden = true;
        play.addEventListener('click', () => audio.play().then(() => {
            peer.needsPlayback = false;
            play.hidden = true;
        }).catch(() => {}));
        audio.autoplay = video.autoplay = video.playsInline = true;
        audio.muted = video.muted = true;
        devices.className = 'small game-note';
        video.hidden = true;
        video.setAttribute('aria-label', `Camera from ${nick}`);
        row.append(name, devices, play, video, audio);
        peersHost.append(row);
        const peer = { row, audio, video, name, devices, play, needsPlayback: false, link: null };
        try {
            peer.link = openGameNightPeer({
                initiates: scope.actor < id,
                send: frame => send('signal', { to: id, ...frame }),
                remoteTrack(track) {
                    const media = peer[track.kind];
                    if (!media || peers.get(id) !== peer) return;
                    media.srcObject = new MediaStream([track]);
                    if (media === audio && !audio.muted) playRemoteAudio(peer);
                    else if (media === video) video.play().catch(() => {});
                },
                connectionChanged(state) { if (state === 'failed') peerFailed(); },
                failed: peerFailed
            });
        } catch {
            row.remove();
            return null;
        }
        function peerFailed() {
            if (peers.get(id) !== peer) return;
            notice = 'A call connection failed. Leave and rejoin the call to try again.';
            draw();
        }
        peers.set(id, peer);
        for (const [kind, track] of tracks) peer.link.setTrack(kind, track);
        return peer;
    }

    function playRemoteAudio(peer) {
        if (!peer.audio.srcObject) return;
        peer.audio.play().catch(() => {
            if (!peer.row.isConnected) return;
            peer.needsPlayback = true;
            peer.play.hidden = peer.audio.muted;
        });
    }

    function roster(frame) {
        if (!joined) { clearTimeout(timer); joined = true; notice = ''; }
        const prior = allowed;
        allowed = { audio: frame.tracks?.audio === true, video: frame.tracks?.video === true };
        canUseCamera = frame.cameraAllowed === true;
        canManageCamera = frame.canManageCamera === true;
        cameraPolicy.textContent = canUseCamera ? 'Disable room cameras' : 'Allow room cameras';
        for (const kind of types) {
            if (allowed[kind]) continue;
            if (prior[kind] && pending?.kind === kind) {
                clearTimeout(pending.timer);
                pending = null;
            }
            if (tracks.has(kind)) detachTrack(kind);
        }
        const current = new Set(frame.peers.map(peer => peer.id));
        for (const id of peers.keys()) if (!current.has(id)) closePeer(id);
        for (const state of frame.peers) {
            const peer = peers.get(state.id) || addPeer(state);
            if (!peer) continue;
            peer.name.textContent = state.nick;
            peer.name.setAttribute('aria-label', `Actions for ${state.nick}`);
            peer.devices.textContent = `Mic ${state.audio ? 'on' : 'off'} · Camera ${state.video ? 'on' : 'off'}`;
            const needsAudio = state.audio && peer.audio.muted;
            peer.audio.muted = !state.audio;
            peer.play.hidden = !state.audio || !peer.needsPlayback;
            peer.video.hidden = !state.video;
            if (needsAudio) playRemoteAudio(peer);
        }
        if (pending && !pending.started && allowed[pending.kind]) void capture(pending);
        draw();
    }

    async function connect() {
        if (!scope || socket || request || !supported) return;
        const attempt = new AbortController();
        request = attempt;
        notice = 'Joining the call…';
        draw();
        timer = setTimeout(() => stop('The call didn’t connect. Try again.'), 10000);
        try {
            const response = await fetch('/beta/game-night-media-ticket', {
                method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(scope), signal: attempt.signal
            });
            if (!response.ok) throw Error('Call admission refused');
            const grant = await response.json();
            if (request !== attempt) return;
            if (grant.protocol !== protocol || !/^m[a-f0-9]{32}$/.test(grant.ticket)) throw Error('Invalid call grant');
            const url = new URL('/beta/game-night-media', location.href);
            url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            const connection = new WebSocket(url, [protocol, grant.ticket]);
            socket = connection;
            connection.addEventListener('close', () => {
                if (socket === connection) stop('The call ended. Chat and games are still available.');
            });
            connection.addEventListener('message', event => {
                if (socket !== connection) return;
                let frame;
                try { frame = JSON.parse(event.data); } catch { return; }
                if (frame.t === 'media-error') {
                    if (!joined) { stop('This call is full or unavailable.'); return; }
                    if (frame.reason === 'tracks-unavailable' && pending && !pending.started) {
                        clearTimeout(pending.timer);
                        pending = null;
                        notice = 'This device isn’t allowed in the call right now.';
                    } else if (frame.reason === 'camera-policy-unavailable') {
                        notice = 'Room camera settings are unavailable.';
                    }
                    draw();
                    return;
                }
                if (frame.version !== 1) return;
                if (frame.t === 'media-ready') send('join');
                else if (frame.t === 'media-room' && Array.isArray(frame.peers)) roster(frame);
                else if (frame.t === 'media-signal') peers.get(frame.from)?.link.receive(frame);
            });
        } catch {
            if (request === attempt) stop('Couldn’t join the call. Try again.');
        } finally {
            if (request === attempt) request = null;
        }
    }

    toggle.addEventListener('click', () => {
        container.hidden = !container.hidden;
        draw();
        if (!container.hidden) {
            container.scrollIntoView({ block: 'nearest' });
            (joined ? leave : join).focus({ preventScroll: true });
        }
    });
    join.addEventListener('click', connect);
    leave.addEventListener('click', () => {
        send('leave');
        stop('You left the call.');
        join.focus();
    });
    adult.addEventListener('change', draw);
    for (const kind of types) buttons[kind].addEventListener('click', () => switchTrack(kind));
    cameraPolicy.addEventListener('click', () => send('camera-policy', { on: !canUseCamera }));
    window.addEventListener('pagehide', () => stop());
    return {
        setRoom(next) {
            if (scope?.room === next?.room && scope?.ref === next?.ref && scope?.actor === next?.actor) return;
            scope = next;
            container.hidden = true;
            stop(next && !supported ? 'This browser doesn’t support calls here.' : '');
        }
    };
}
