import { openGameNightPeer } from './game-night-peer.mjs';

const protocol = 'game-night-media.v1';
const off = () => ({ audio: false, video: false });
const types = ['audio', 'video'];
const device = { audio: 'microphone', video: 'camera' };
const reportMarkup = `
    <h3 id="call-report-title">Report call participant</h3>
    <p data-call-report-target></p>
    <p>Community staff receive the participant’s name, the room reference and your description. Calls are unrecorded.</p>
    <form>
        <label>What happened?
            <textarea name="reason" rows="4" maxlength="380" required data-call-report-reason></textarea>
        </label>
        <label class="call-report-consent"><input type="checkbox" required data-call-report-consent> Share these details with community staff</label>
        <p role="status" data-call-report-status></p>
        <div class="sheet-buttons">
            <button class="btn" type="submit" data-call-report-send>Send report</button>
            <button class="btn btn--ghost" type="button" data-call-report-close>Cancel</button>
        </div>
    </form>`;

export function mountGameNightCall(container, toggle, { personActions }) {
    const document = container.ownerDocument;
    const $ = selector => container.querySelector(selector);
    const join = $('[data-call-join]'), leave = $('[data-call-leave]');
    const hide = $('[data-call-hide]'), stage = container.closest('[data-game-night]');
    const status = $('[data-call-status]'), peersHost = $('[data-call-peers]');
    const adult = $('[data-call-adult]'), cameraPolicy = $('[data-call-policy]');
    const buttons = { audio: $('[data-call-mic]'), video: $('[data-call-camera]') };
    const report = document.createElement('dialog');
    report.className = 'sheet';
    report.setAttribute('aria-labelledby', 'call-report-title');
    report.innerHTML = reportMarkup;
    document.body.append(report);
    const reportForm = report.querySelector('form');
    const reportReason = report.querySelector('[data-call-report-reason]'), reportConsent = report.querySelector('[data-call-report-consent]');
    const reportStatus = report.querySelector('[data-call-report-status]'), reportSend = report.querySelector('[data-call-report-send]');
    const reportClose = report.querySelector('[data-call-report-close]');
    const recent = document.createElement('details'), recentTitle = document.createElement('summary');
    const recentList = document.createElement('ul');
    recent.className = 'game-call-recent';
    recentList.className = 'game-call-peers';
    recentTitle.textContent = 'Report a recent call participant';
    recent.hidden = true;
    recent.append(recentTitle, recentList);
    peersHost.after(recent);
    const peers = new Map(), tracks = new Map();
    let scope = null, socket = null, request = null, timer, joined = false;
    let relayAvailable = false, relayTimer = null, iceServers = [];
    let reportsAvailable = false, reportDraft = null, reportTimer = null;
    let recentSignature = '';
    let allowed = off(), canUseCamera = false, canManageCamera = false, pending = null;
    const supported = !!(navigator.mediaDevices?.getUserMedia && window.RTCPeerConnection);
    let notice = '';
    let previousView = null;

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
        clearTimeout(relayTimer);
        clearTimeout(reportTimer);
        relayTimer = null;
        relayAvailable = false;
        iceServers = [];
        clearTimeout(pending?.timer);
        pending = null;
        request?.abort(); request = null;
        const prior = socket;
        socket = null;
        const unconfirmedReport = !!reportDraft?.attempt;
        if (prior && prior.readyState < WebSocket.CLOSING) prior.close(1000);
        for (const id of peers.keys()) closePeer(id);
        for (const kind of types) detachTrack(kind);
        allowed = off();
        adult.checked = false;
        canUseCamera = canManageCamera = joined = false;
        reportsAvailable = false;
        drawRecentReports([]);
        notice = unconfirmedReport && message ? message + ' Report delivery was unconfirmed.' : message;
        draw();
        if (report.open) closeReport();
    }

    function drawReport(waiting) {
        reportReason.disabled = reportConsent.disabled = reportClose.disabled = waiting;
        reportSend.disabled = waiting || !reportConsent.checked;
    }

    function openReport(id, nick, opener) {
        if (!joined || !reportsAvailable || report.open) return;
        reportDraft = { id, opener, attempt: null, waiting: false };
        reportForm.reset();
        report.querySelector('[data-call-report-target]').textContent = nick;
        reportStatus.textContent = '';
        drawReport(false);
        report.showModal();
        reportReason.focus();
    }

    function closeReport() {
        clearTimeout(reportTimer);
        const opener = reportDraft?.opener;
        reportDraft = null;
        report.close();
        reportForm.reset();
        reportStatus.textContent = '';
        if (!scope) return;
        const target = opener?.isConnected && opener.getClientRects().length && !container.hidden && joined ? opener : toggle;
        target.focus({ preventScroll: true });
    }

    function drawRecentReports(people) {
        const signature = JSON.stringify(people);
        if (signature === recentSignature) return;
        recentSignature = signature;
        recent.hidden = people.length === 0;
        if (recent.hidden) recent.open = false;
        recentList.replaceChildren(...people.map(({ id, nick }) => {
            const row = document.createElement('li'), flag = document.createElement('button');
            flag.type = 'button';
            flag.className = 'btn btn--small btn--ghost';
            flag.textContent = 'Report ' + nick;
            flag.addEventListener('click', () => openReport(id, nick, flag));
            row.append(flag);
            return row;
        }));
    }

    function finishReportWait(message) {
        clearTimeout(reportTimer);
        reportDraft.waiting = false;
        reportStatus.textContent = message;
        drawReport(false);
    }

    function receiveReport(frame) {
        const attempt = reportDraft?.attempt;
        if (!report.open || !attempt || attempt.request !== frame.request || attempt.reason !== reportReason.value.trim()) return;
        if (frame.status === 'queued') {
            closeReport();
            notice = 'Queued for review when a moderator is available.';
            draw();
            return;
        }
        const messages = {
            invalid: 'Check the description and remove any invitation links or access codes.',
            limited: 'The report allowance is full. Wait before trying again.',
            conflict: 'This report conflicts with an earlier submission. Close this form and try again.',
            'peer-unavailable': 'This call participant is no longer available to report.'
        };
        finishReportWait(messages[frame.status] || 'Report delivery is unconfirmed. Retry the same details to check.');
    }

    reportForm.addEventListener('submit', event => {
        event.preventDefault();
        if (!reportDraft || reportDraft.waiting || !joined || !reportsAvailable || !reportConsent.checked) return;
        const reason = reportReason.value.trim();
        if (!reason) {
            reportStatus.textContent = 'Describe what happened.';
            reportReason.focus();
            return;
        }
        if (reportDraft.attempt?.reason !== reason) {
            const bytes = crypto.getRandomValues(new Uint8Array(18));
            const request = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_');
            reportDraft.attempt = { request, reason };
        }
        if (!send('report', { target: reportDraft.id, ...reportDraft.attempt, consent: true })) {
            finishReportWait('Call disconnected. Report delivery is unconfirmed.');
            return;
        }
        reportDraft.waiting = true;
        drawReport(true);
        reportStatus.textContent = 'Waiting for confirmation…';
        reportTimer = setTimeout(() => finishReportWait('Report delivery is unconfirmed. Retry the same details to check.'), 12000);
    });
    reportConsent.addEventListener('change', () => drawReport(false));
    reportClose.addEventListener('click', closeReport);
    report.addEventListener('cancel', event => {
        event.preventDefault();
        if (!reportDraft?.waiting) closeReport();
    });

    function retryRelay(delay) {
        clearTimeout(relayTimer);
        relayTimer = setTimeout(() => {
            relayTimer = null;
            requestRelay();
        }, delay);
    }

    function requestRelay() {
        if (relayAvailable && peers.size && !relayTimer && send('relay')) retryRelay(60_000);
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
        const actions = document.createElement('div'), flag = document.createElement('button');
        const video = document.createElement('video'), audio = document.createElement('audio');
        const play = document.createElement('button'), devices = document.createElement('span');
        name.type = play.type = 'button';
        name.className = play.className = 'btn btn--small btn--ghost';
        name.textContent = nick;
        name.setAttribute('aria-label', `Actions for ${nick}`);
        name.addEventListener('click', () => personActions(id));
        actions.className = 'game-call-peer-actions';
        flag.type = 'button';
        flag.className = name.className;
        flag.textContent = 'Report';
        flag.addEventListener('click', () => openReport(id, name.textContent, flag));
        actions.append(name, flag);
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
        row.append(actions, devices, play, video, audio);
        peersHost.append(row);
        const peer = { row, audio, video, name, flag, devices, play, needsPlayback: false, link: null };
        try {
            peer.link = openGameNightPeer({
                initiates: scope.actor < id,
                iceServers,
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
        relayAvailable = frame.relay === true;
        reportsAvailable = frame.reports === true;
        drawRecentReports(reportsAvailable && Array.isArray(frame.recentReportPeers) ? frame.recentReportPeers : []);
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
            peer.flag.hidden = !reportsAvailable;
            peer.flag.setAttribute('aria-label', `Report ${state.nick} from this call`);
            peer.devices.textContent = `Mic ${state.audio ? 'on' : 'off'} · Camera ${state.video ? 'on' : 'off'}`;
            const needsAudio = state.audio && peer.audio.muted;
            peer.audio.muted = !state.audio;
            peer.play.hidden = !state.audio || !peer.needsPlayback;
            peer.video.hidden = !state.video;
            if (needsAudio) playRemoteAudio(peer);
        }
        if (pending && !pending.started && allowed[pending.kind]) void capture(pending);
        requestRelay();
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
                else if (frame.t === 'media-report') receiveReport(frame);
                else if (frame.t === 'media-relay' && relayAvailable && Array.isArray(frame.iceServers) &&
                    Number.isSafeInteger(frame.refreshInMs) && frame.refreshInMs > 0) {
                    iceServers = frame.iceServers;
                    for (const peer of peers.values()) peer.link.setIceServers(iceServers);
                    retryRelay(frame.refreshInMs);
                }
            });
        } catch {
            if (request === attempt) stop('Couldn’t join the call. Try again.');
        } finally {
            if (request === attempt) request = null;
        }
    }

    const activeGame = () => stage?.querySelector(':scope > details[open]');
    function hideControls() {
        container.hidden = true;
        draw();
        if (stage && previousView && previousView.game === activeGame()) stage.scrollTop = previousView.scrollTop;
        previousView = null;
        toggle.focus({ preventScroll: true });
    }
    toggle.addEventListener('click', () => {
        if (!container.hidden) {
            hideControls();
            return;
        }
        if (stage) previousView = { game: activeGame(), scrollTop: stage.scrollTop };
        container.hidden = false;
        draw();
        container.scrollIntoView({ block: 'nearest' });
        (joined ? hide || toggle : join).focus({ preventScroll: true });
    });
    hide?.addEventListener('click', hideControls);
    container.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        hideControls();
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
            previousView = null;
            container.hidden = true;
            stop(next && !supported ? 'This browser doesn’t support calls here.' : '');
        }
    };
}
