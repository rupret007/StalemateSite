/* Stalemate Hang Out room. Hidden preview: not linked from the public site.
 * Draw + synced video + chat over an end-to-end encrypted relay, plus an opt-in
 * peer-to-peer camera/mic mesh for up to 8 people. No media ever touches the relay. */
(function hangoutRoom(win, doc) {
    'use strict';

    const H = win.HangoutCore;
    const V = win.HangoutVideo;
    const S = win.HangoutPrivateSnapshot;
    const R = win.HangoutPrivateRecovery;
    const $ = (sel) => doc.querySelector(sel);
    // Capture once; each receiver gets it scaled for how big they show us. Most people are on
    // phones, so phones and low-power devices default lighter (battery + cell data).
    const mq = (q) => { try { return Boolean(win.matchMedia && win.matchMedia(q).matches); } catch (error) { return false; } };
    const PHONE = V.isPhoneDevice({ ua: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, coarse: mq('(pointer: coarse)'), fine: mq('(any-pointer: fine)'), cores: navigator.hardwareConcurrency });
    const CAM = PHONE
        ? { width: { ideal: 480, max: 640 }, height: { ideal: 360, max: 480 }, frameRate: { ideal: 15, max: 20 } }
        : { width: { ideal: 640, max: 640 }, height: { ideal: 360, max: 480 }, frameRate: { ideal: 24, max: 24 } };
    const CANVAS_CAM = { width: { ideal: 640, max: 640 }, height: { ideal: 480, max: 480 }, frameRate: { ideal: 15, max: 15 }, facingMode: { ideal: 'environment' } };
    const CAM_BPS = 250000;
    const MIC_BPS = 32000;
    const MUSIC_BPS = 128000;
    const STUN = [{ urls: 'stun:stun.cloudflare.com:3478' }];
    const HOST_STORE = 'stalemate-hangout-host:';

    const params = new URLSearchParams(win.location.search);
    const isLocal = /^(127\.0\.0\.1|localhost)$/.test(win.location.hostname);
    const relayBase = (isLocal && params.get('relay')) || ($('meta[name="hangout-relay"]').content || '');
    const turnUrl = (isLocal && params.get('turn')) || ($('meta[name="hangout-turn"]').content || '');
    const previewKey = params.get('preview') || '';

    const ui = {
        gate: $('[data-gate]'), gateTitle: $('[data-gate-title]'), gateCopy: $('[data-gate-copy]'), gateStatus: $('[data-gate-status]'),
        name: $('[data-name]'), enter: $('[data-enter]'), room: $('[data-room]'), peers: $('[data-peers]'), status: $('[data-status]'),
        copy: $('[data-copy]'), load: $('[data-load]'), url: $('[data-url]'), picks: $('[data-picks]'), hostNote: $('[data-host-note]'),
        canvas: $('[data-canvas]'), swatches: $('[data-swatches]'), size: $('[data-size]'), clear: $('[data-clear]'), save: $('[data-save]'),
        log: $('[data-log]'), say: $('[data-say]'), text: $('[data-text]'), tiles: $('[data-tiles]'),
        syncStatus: $('[data-sync-status]'), syncRetry: $('[data-sync-retry]'),
        privateReport: $('[data-private-report]'), reportDialog: $('[data-report-dialog]'), reportForm: $('[data-report-form]'),
        reportKind: $('[data-report-kind]'), reportTarget: $('[data-report-target]'), reportName: $('[data-report-name]'),
        reportExcerpt: $('[data-report-excerpt]'), reportReason: $('[data-report-reason]'), reportConsent: $('[data-report-consent]'),
        reportStatus: $('[data-report-status]'), reportAvailability: $('[data-report-availability]'), reportSend: $('[data-report-send]'),
        reportRetry: $('[data-report-retry]'), reportNew: $('[data-report-new]'), reportClose: $('[data-report-close]'),
        mic: $('[data-mic]'), cam: $('[data-cam]'), hangup: $('[data-hangup]'), ask: $('[data-ask]'), turnStatus: $('[data-turn-status]'),
        askTitle: $('[data-ask-title]'), askCopy: $('[data-ask-copy]'), askYes: $('[data-ask-yes]'), askNo: $('[data-ask-no]'),
        yt: $('[data-yt]'), file: $('[data-file]'), tap: $('[data-tap]'), videoStatus: $('[data-video-status]'),
        bobToggle: $('[data-bob-toggle]'), bob: $('[data-bob]'), bobNow: $('[data-bob-now]'), bobHold: $('[data-bob-hold]'),
        bobRewind: $('[data-bob-rewind]'), bobCatchup: $('[data-bob-catchup]'), bobNudge: $('[data-bob-nudge]'),
        bobEpisodes: $('[data-bob-episodes]'), bobPalette: $('[data-bob-palette]'), bobBrushes: $('[data-bob-brushes]'),
        canvasCam: $('[data-canvas-cam]'),
        share: $('[data-share]'), pip: $('[data-pip]'), hand: $('[data-hand]'), view: $('[data-view-toggle]'), reacts: $('[data-reacts]'), reactFloat: $('[data-react-float]'),
        settings: $('[data-settings]'), settingsDlg: $('[data-settings-dlg]'), devCam: $('[data-dev-cam]'), devMic: $('[data-dev-mic]'), devSpk: $('[data-dev-spk]'),
        music: $('[data-music]'), jamNote: $('[data-jam-note]'), bgPicks: $('[data-bg-picks]'), bgStatus: $('[data-bg-status]'), bgSupport: $('[data-bg-support]'),
        lock: $('[data-lock]'), allCamsOff: $('[data-all-cams-off]'), hands: $('[data-hands]'), tileMenu: $('[data-tile-menu]'),
        checkBtn: $('[data-check-btn]'), check: $('[data-check]'), checkVideo: $('[data-check-video]'), checkMeter: $('[data-check-meter]'), checkOut: $('[data-check-out]'), checkDone: $('[data-check-done]')
    };
    const BOB = win.BobRoss;

    const app = {
        state: H.emptyState(), clock: H.createClock(), ws: null, myId: null, key: null, roomId: null,
        hostPub: null, hostPriv: null, isHost: false, lastHostSeq: 0, lastHostSigned: null, lastVideoSigned: null,
        lastClearSigned: null, drawingEpoch: 0, snapshotRequest: null, snapshotFresh: false, knownHostId: null,
        names: new Map(), name: '', snapshotDone: false, snapshotFrom: null, snapshotHasSeqProof: false, connected: false, ended: false, retries: 0, privateReports: false,
        bob: { on: false, touched: false, lastNudge: 0 },
        av: {
            stream: null, rawCam: null, mic: false, cam: false, canvas: false, screen: null, hand: null, away: false, music: false,
            jam: params.get('kind') === 'jam', asked: {}, view: 'grid', pin: null, spot: null, locked: false, kicked: false,
            canvasPeers: new Set(), camPeers: new Set(), micPeers: new Set(), screenPeers: new Set(), awayPeers: new Set(), hands: {},
            peers: new Set(), pcs: new Map(), opening: new Map(), ice: null, adult18: false, relayed: new Set(), removed: new Set(), lockedOut: new Set(), hidden: new Set(),
            levels: {}, meters: new Map(), ac: null, speaker: { id: null, since: 0 }, wantSent: new Map(), reactTimes: [], peerReacts: new Map(),
            mods: {}, bg: { choice: 'none', proc: null, el: null, frames: [], loading: false, light: false }, sink: null, lock: null
        }
    };
    win.__hangout = app; // test hook, read-only use

    function say(text) { ui.status.textContent = text; }
    function setGate(text) { ui.gateStatus.textContent = text; }

    /* Private reports are deliberately outside chat state, encrypted snapshots,
     * and the outbound content queue. Only an explicit consent click sends the
     * selected fields to the protected relay's staff-intake control. */
    let receivedChatOrigins = new WeakMap();
    const staffReport = { attempt: null, phase: 'draft', timer: 0, opener: null, uncertainEdit: false };
    const reportFields = [ui.reportKind, ui.reportTarget, ui.reportName, ui.reportExcerpt, ui.reportReason];
    function reportOnline() { return !app.ended && app.connected && app.privateReports && app.ws?.readyState === 1; }
    function updateReportControls() {
        const waiting = staffReport.phase === 'waiting';
        const ready = reportOnline();
        ui.privateReport.hidden = !app.privateReports;
        for (const field of [...reportFields, ui.reportConsent]) field.disabled = waiting;
        ui.reportSend.disabled = !ready || waiting || staffReport.phase === 'saved' || !ui.reportConsent.checked;
        ui.reportRetry.hidden = !staffReport.attempt || !['unconfirmed', 'error'].includes(staffReport.phase);
        ui.reportRetry.disabled = !ready || waiting || !ui.reportConsent.checked;
        ui.reportNew.disabled = waiting;
        ui.reportAvailability.textContent = app.ended ? 'This room session has ended.'
            : !app.privateReports ? 'Staff reporting is unavailable on this room server. No new report can be sent.'
                : !ready ? 'Offline. Your report draft stays here; reconnect before sending or retrying.' : '';
        ui.reportAvailability.hidden = !ui.reportAvailability.textContent;
    }
    function stopReportWait() { clearTimeout(staffReport.timer); staffReport.timer = 0; }
    function reportDraftChanged() {
        stopReportWait();
        staffReport.uncertainEdit ||= Boolean(staffReport.attempt && staffReport.phase !== 'saved');
        staffReport.attempt = null;
        staffReport.phase = 'draft';
        ui.reportConsent.checked = false;
        ui.reportStatus.textContent = staffReport.uncertainEdit
            ? 'Details changed. The earlier report was not confirmed; it may have been saved. Sending these details creates a new report.'
            : 'Draft only. Review the selected details and agree before sending.';
        updateReportControls();
    }
    function reportMembers(selected = '', selectedName = '') {
        const option = doc.createElement('option');
        option.value = ''; option.textContent = 'Someone who left, the host, or another problem';
        ui.reportTarget.replaceChildren(option);
        const members = new Map(app.names);
        if (selected && !members.has(selected)) members.set(selected, selectedName || 'Someone who left');
        for (const [peer, name] of members) {
            if (peer === app.myId) continue;
            const entry = doc.createElement('option'); entry.value = peer;
            entry.textContent = String(name || 'Someone').slice(0, 24);
            ui.reportTarget.append(entry);
        }
        ui.reportTarget.value = selected;
    }
    function clearStaffReport() {
        stopReportWait(); staffReport.attempt = null; staffReport.phase = 'draft'; staffReport.uncertainEdit = false;
        ui.reportForm.reset(); reportMembers();
        ui.reportStatus.textContent = 'New draft. Nothing from this draft has been sent.';
        updateReportControls();
    }
    function openStaffReport({ line = null, peer = null, name = '' } = {}, opener = null) {
        if (!app.privateReports || app.ended) return;
        if (staffReport.phase !== 'waiting' && (line || peer)) {
            clearStaffReport();
            const origin = line ? receivedChatOrigins.get(line) : null;
            const target = origin?.peer || peer || '';
            const claimedName = String(line?.name || name || app.names.get(target) || '').slice(0, 24);
            ui.reportKind.value = line ? 'message' : 'member';
            reportMembers(target, claimedName);
            ui.reportName.value = claimedName;
            ui.reportExcerpt.value = line ? String(line.text || '').slice(0, 400) : '';
        } else {
            reportMembers(ui.reportTarget.value, ui.reportName.value);
        }
        staffReport.opener = opener || doc.activeElement;
        updateReportControls();
        if (!ui.reportDialog.open) ui.reportDialog.showModal();
        (ui.reportReason.disabled ? ui.reportClose : ui.reportReason).focus();
    }
    function reportContainsCredentials(fields) {
        const content = [fields.claimedName, fields.excerpt, fields.reason].join('\n');
        const invite = readInvite();
        if ([invite?.secret, invite?.host, previewKey].some(value => value && value.length >= 16 && content.includes(value))) return true;
        return /(?:[#?&](?:invite|preview|r|h)=|webjam(?:-signal)?:|\b(?:BW_SESSION|Authorization|Cookie)\s*[:=])/i.test(content);
    }
    function submitStaffReport() {
        if (!reportOnline() || staffReport.phase === 'waiting' || !ui.reportConsent.checked || !ui.reportForm.reportValidity()) return;
        const fields = { kind: ui.reportKind.value, target: ui.reportTarget.value || null,
            claimedName: ui.reportName.value.trim().slice(0, 24), excerpt: ui.reportExcerpt.value.trim().slice(0, 400),
            reason: ui.reportReason.value.trim().slice(0, 400) };
        if (!['message', 'member'].includes(fields.kind) || !fields.reason || fields.kind === 'message' && !fields.excerpt) {
            ui.reportStatus.textContent = 'Add a reason and, for a message report, the selected quote. Nothing was sent.';
            return;
        }
        if (reportContainsCredentials(fields)) {
            ui.reportStatus.textContent = 'Remove invitation links, room keys and access credentials before sending. Nothing was sent.';
            return;
        }
        const signature = JSON.stringify(fields);
        if (!staffReport.attempt || staffReport.attempt.signature !== signature) {
            staffReport.attempt = { signature, payload: { type: 'private-report', v: 1, request: H.newSecret(), ...fields, consent: true }, socket: null };
        }
        const attempt = staffReport.attempt, socket = app.ws;
        attempt.socket = socket; staffReport.phase = 'waiting'; staffReport.uncertainEdit = false;
        ui.reportStatus.textContent = 'Sending the selected details. Waiting for confirmation…';
        stopReportWait(); updateReportControls();
        staffReport.timer = win.setTimeout(() => {
            if (staffReport.attempt !== attempt || attempt.socket !== socket || app.ws !== socket || staffReport.phase !== 'waiting') return;
            staffReport.timer = 0; attempt.socket = null; staffReport.phase = 'unconfirmed';
            ui.reportStatus.textContent = 'Not confirmed. The report may have been saved. Retry the same report to check safely; it will not send automatically.';
            updateReportControls();
        }, 15000);
        try {
            // This opt-in control intentionally stays plaintext to staff over
            // the current protected WSS connection. Never seal or pace it.
            socket.send(JSON.stringify(attempt.payload));
        } catch (_) {
            stopReportWait(); attempt.socket = null; staffReport.phase = 'unconfirmed';
            ui.reportStatus.textContent = 'Not confirmed. Reconnect if needed, then retry the same report manually.';
            updateReportControls();
        }
    }
    function receiveStaffReportAck(value, socket) {
        const attempt = staffReport.attempt;
        if (!reportOnline() || socket !== app.ws || !attempt || attempt.socket !== socket ||
            staffReport.phase !== 'waiting' || !value || typeof value !== 'object' || value.request !== attempt.payload.request) return;
        if (value.ok === true && typeof value.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value.id) &&
            ['pending', 'resolved', 'dismissed'].includes(value.status)) {
            stopReportWait(); attempt.socket = null; staffReport.phase = 'saved';
            ui.reportStatus.textContent = value.status === 'pending' ? 'Saved for community staff review. This is not a promise of immediate response.'
                : value.status === 'resolved' ? 'Saved report confirmed. Community staff have resolved it.' : 'Saved report confirmed. Community staff have dismissed it.';
            updateReportControls();
        } else if (value.ok === false && [400, 409, 429, 503].includes(value.status)) {
            stopReportWait(); attempt.socket = null; staffReport.phase = 'error';
            ui.reportStatus.textContent = value.status === 429 ? 'Not saved: the report allowance is full. Wait before retrying the same report.'
                : value.status === 409 ? 'Not saved: this request conflicts with an earlier report. Review the details before starting a new report.'
                    : value.status === 400 ? value.error === 'unsafe-content'
                        ? 'Not saved: remove invitation or credential details. You can clear the quote and report the member with a brief reason instead.'
                        : 'Not saved: review the report fields before trying again.'
                        : 'Not confirmed: staff report storage is unavailable. Retry the same report manually later.';
            updateReportControls();
        }
    }
    function staffReportDisconnected(socket) {
        if (staffReport.attempt?.socket === socket) {
            stopReportWait(); staffReport.attempt.socket = null; staffReport.phase = 'unconfirmed';
            ui.reportStatus.textContent = 'Not confirmed: the connection closed. Your report draft remains here. Reconnect, then retry the same report manually.';
        }
        updateReportControls();
    }
    ui.privateReport.addEventListener('click', () => openStaffReport({}, ui.privateReport));
    ui.reportForm.addEventListener('submit', event => { event.preventDefault(); submitStaffReport(); });
    ui.reportRetry.addEventListener('click', submitStaffReport);
    ui.reportNew.addEventListener('click', () => { clearStaffReport(); ui.reportReason.focus(); });
    ui.reportClose.addEventListener('click', () => ui.reportDialog.close());
    ui.reportDialog.addEventListener('close', () => { if (staffReport.opener?.isConnected) staffReport.opener.focus(); staffReport.opener = null; });
    for (const field of reportFields.filter(field => field !== ui.reportTarget)) field.addEventListener('input', reportDraftChanged);
    ui.reportTarget.addEventListener('change', () => {
        if (ui.reportTarget.value) ui.reportName.value = String(app.names.get(ui.reportTarget.value) || '').slice(0, 24);
        reportDraftChanged();
    });
    ui.reportConsent.addEventListener('change', updateReportControls);

    /* ---------------- invite + host identity ---------------- */
    function readInvite() {
        const frag = new URLSearchParams(win.location.hash.slice(1));
        const secret = frag.get('r');
        const host = frag.get('h');
        return H.validSecret(secret) && /^[A-Za-z0-9_-]{80,100}$/.test(host || '') ? { secret, host } : null;
    }

    async function makeRoom() {
        const secret = H.newSecret();
        const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
        const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
        const host = b64u(pubRaw);
        const privJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
        const { roomId } = await H.deriveRoom(secret);
        try { localStorage.setItem(HOST_STORE + roomId, JSON.stringify(privJwk)); } catch (error) { /* private mode: host only for this tab */ }
        app.hostPrivMemory = pair.privateKey;
        win.history.replaceState(null, '', `${win.location.pathname}${win.location.search}#r=${secret}&h=${host}`);
        return { secret, host };
    }

    function b64u(bytes) {
        let s = '';
        bytes.forEach((b) => { s += String.fromCharCode(b); });
        return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function unb64u(t) { const s = atob(t.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, (c) => c.charCodeAt(0)); }

    async function loadIdentity(invite) {
        const { roomId, key } = await H.deriveRoom(invite.secret);
        app.roomId = roomId;
        app.key = key;
        app.hostPub = await crypto.subtle.importKey('raw', unb64u(invite.host), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
        let priv = app.hostPrivMemory || null;
        if (!priv) {
            try {
                const jwk = JSON.parse(localStorage.getItem(HOST_STORE + roomId) || 'null');
                if (jwk) priv = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
            } catch (error) { priv = null; }
        }
        app.hostPriv = priv;
        app.isHost = Boolean(priv);
    }

    const SIGN = { name: 'ECDSA', hash: 'SHA-256' };
    const authorityWork = new Set();
    const inboundWork = new WeakMap();
    const inboundAuthority = new WeakMap();
    const snapshotJobs = new Map();
    const futureStrokes = new Map();
    const sealingStrokes = new Set();
    const retirementWaiters = new Set();
    let futureStrokePoints = 0;
    let recovery = null;
    let authorityTail = null;
    function hostWork(work) {
        // Reserve, sign, commit and encrypt each action in the same order.
        // Receivers retain one global replay floor for all host actions.
        const run = () => !app.ended && app.connected && app.isHost ? work() : false;
        const task = authorityTail ? authorityTail.then(run, run) : Promise.resolve(run());
        authorityTail = task;
        authorityWork.add(task);
        const settled = () => {
            authorityWork.delete(task);
            if (authorityTail === task) authorityTail = null;
        };
        void task.then(settled, settled);
        return task;
    }
    function relayCurrent(meta) {
        return !app.ended && app.connected && app.ws === meta.socket && meta.socket.readyState === 1;
    }
    function canonical(body) { return new TextEncoder().encode(JSON.stringify(body)); }
    async function signHost(body) {
        const sig = new Uint8Array(await crypto.subtle.sign(SIGN, app.hostPriv, canonical(body)));
        return { type: 'host', body, sig: b64u(sig) };
    }
    async function verifyHost(msg) {
        if (!msg || !msg.body || typeof msg.sig !== 'string') return false;
        try { return await crypto.subtle.verify(SIGN, app.hostPub, unb64u(msg.sig), canonical(msg.body)); } catch (error) { return false; }
    }

    /* ---------------- relay ---------------- */
    /* Pace frames under the relay's token bucket (burst 30, 8/s) so call setup bursts
     * (ICE candidates, offers, flags) queue up instead of being dropped as "slow". */
    const pace = { tokens: 24, last: Date.now(), queue: [], timer: 0 };
    function paceTake() {
        const now = Date.now();
        pace.tokens = Math.min(24, pace.tokens + ((now - pace.last) / 1000) * 7);
        pace.last = now;
        if (pace.tokens < 1) return false;
        pace.tokens -= 1;
        return true;
    }
    const QUEUE_MAX = 200;
    function paceFlush() {
        pace.timer = 0;
        while (pace.queue.length) {
            const item = pace.queue[0];
            if (item.socket && (item.socket !== app.ws || item.socket.readyState !== 1)) { pace.queue.shift(); continue; }
            if (!app.ws || app.ws.readyState !== 1 || !paceTake()) break;
            const next = pace.queue.shift();
            if (next.activity) recordStroke(next.activity);
            app.ws.send(next.frame);
        }
        if (pace.queue.length && app.ws?.readyState === 1) pace.timer = win.setTimeout(paceFlush, 150);
    }
    async function send(obj) {
        const socket = app.ws;
        const roomScoped = ['chat', 'stroke', 'host'].includes(obj.type);
        if (app.ended || !socket || socket.readyState !== 1 && !roomScoped) return;
        // Keep the drawing operation before native encryption yields. A fresh
        // connection can finish recovering while that encryption is pending.
        const activity = obj.type === 'stroke' ? JSON.parse(JSON.stringify(obj)) : null;
        if (activity) sealingStrokes.add(activity);
        try {
            const frame = JSON.stringify(await H.seal(app.key, obj));
            if (app.ended || !roomScoped && (app.ws !== socket || socket.readyState !== 1)) return;
            // Room content keeps its original envelope; media and presence belong
            // only to the relay identity that existed before encryption began.
            pace.queue = V.enqueue(pace.queue, { frame, socket: roomScoped ? null : socket,
                activity, ice: obj.type === 'rtc' && Boolean(obj.ice), priority: obj.type === 'host' }, QUEUE_MAX);
            if (!pace.timer) paceFlush();
        } finally {
            if (activity) sealingStrokes.delete(activity);
        }
    }

    if (isLocal) { win.__hangoutSend = send; win.__hangoutPace = pace; } // local test hooks only (localhost)

    // Tokens belong to the relay's current peer identities, not display names.
    // A leave invalidates in-flight media work without retaining departed IDs.
    const relayPeers = new Map();
    function notifyRetirement() {
        for (const resolve of retirementWaiters) resolve();
        retirementWaiters.clear();
    }
    function retireRelayPeer(id) {
        const peer = relayPeers.get(id);
        if (peer) peer.live = false;
        relayPeers.delete(id);
        notifyRetirement();
        const job = snapshotJobs.get(id);
        if (job) { clearTimeout(job.timer); snapshotJobs.delete(id); }
    }
    function retireRelayPeers() {
        for (const peer of relayPeers.values()) peer.live = false;
        relayPeers.clear();
        notifyRetirement();
    }

    let reconnectTimer;
    function syncNotice(text, retry = false) {
        ui.syncStatus.textContent = text;
        ui.syncStatus.hidden = !text;
        ui.syncRetry.hidden = !retry;
    }
    function cancelRecovery() {
        if (recovery) {
            clearTimeout(recovery.timer);
            recovery.cancelled = true;
            recovery.resolve(false);
        }
        recovery = null;
        syncNotice('');
    }
    function recoveryCurrent(context, meta) {
        return context && recovery === context && !context.cancelled && !context.failed
            && !context.complete && relayCurrent(meta) && context.socket === meta.socket;
    }
    function beginRecovery(socket) {
        cancelRecovery();
        const context = { socket, to: app.myId, request: H.newSecret(), seqFloor: app.lastHostSeq,
            epochFloor: app.drawingEpoch, journal: R.createJournal({ H }), peers: new Map(),
            fresh: null, complete: false, failed: false, cancelled: false, peerApplied: false };
        context.ready = new Promise(resolve => { context.resolve = resolve; });
        recovery = context;
        for (const activity of sealingStrokes) context.journal.recordStroke(activity);
        for (const item of pace.queue) if (item.activity) context.journal.recordStroke(item.activity);
        app.snapshotRequest = context.request;
        app.snapshotDone = false; app.snapshotFrom = null; app.snapshotHasSeqProof = false; app.snapshotFresh = false;
        context.timer = win.setTimeout(() => {
            if (recovery !== context || context.complete || context.cancelled) return;
            failRecovery(context, context.peerApplied
                ? 'The drawing is shared. The host has not confirmed the current room controls. Retry when they return.'
                : 'Room activity has not caught up. Chat is still live. Retry room sync.');
        }, 15000);
        syncNotice('Getting the room’s drawing and watch state…');
        return context;
    }
    function finishRecovery(context, fresh, from, proof) {
        if (recovery !== context) return;
        context.complete = true;
        clearTimeout(context.timer);
        app.snapshotDone = true; app.snapshotFresh = fresh;
        app.snapshotFrom = from || null; app.snapshotHasSeqProof = Boolean(proof);
        context.resolve(true);
        syncNotice('');
    }
    function finishOwnRecovery() {
        if (recovery && app.isHost) finishRecovery(recovery, true, app.myId, true);
    }
    function failRecovery(context, text) {
        if (recovery !== context || context.complete || context.cancelled) return;
        context.failed = true;
        clearTimeout(context.timer);
        context.resolve(false);
        syncNotice(text || 'The drawing could not catch up safely. Retry room sync.', true);
    }
    function recordStroke(message) {
        if (recovery && !recovery.complete && !recovery.failed) recovery.journal.recordStroke(message);
    }
    function recordHost(message, t) {
        if (['clear', 'video', 'lock', 'spot'].includes(message.body?.kind)
            && recovery && !recovery.complete && !recovery.failed) recovery.journal.recordHost(message, t);
        tryPendingRecovery();
    }
    function tryPendingRecovery() {
        const pending = recovery?.pendingSnapshot;
        if (pending) commitRecovered(pending.snapshot, recovery, pending.meta, pending.provenSeq);
    }
    function applyDrawingMessage(message) {
        if (H.apply(app.state, message) === 'draw') drawStroke(app.state.strokes.find(stroke => stroke.id === message.stroke.id));
    }
    function applyDeferredStrokes(state = app.state, epoch = app.drawingEpoch, consume = true) {
        for (const [key, message] of futureStrokes) {
            if (message.epoch > epoch) continue;
            if (consume) { futureStrokes.delete(key); futureStrokePoints -= message.stroke.pts.length; }
            if (message.epoch === epoch) H.apply(state, message);
        }
        return H.strokeRangeStatus(state);
    }
    function acceptStroke(message) {
        recordStroke(message);
        if (Object.hasOwn(message, 'epoch') && message.epoch !== app.drawingEpoch) {
            if (!Number.isSafeInteger(message.epoch) || message.epoch < app.drawingEpoch
                || !Number.isInteger(message.offset) || message.offset < 0) return;
            const stroke = H.cleanStroke(message.stroke);
            if (!stroke || message.offset + stroke.pts.length > H.LIMITS.strokeTotalPoints) return;
            const key = `${message.epoch}:${stroke.id}:${message.offset}`;
            const item = { type: 'stroke', epoch: message.epoch, offset: message.offset, stroke };
            const previous = futureStrokes.get(key);
            if (previous) {
                if (JSON.stringify(previous) !== JSON.stringify(item)) syncNotice('The drawing has conflicting updates. Retry room sync.', true);
                return;
            }
            if (futureStrokes.size >= 128 || futureStrokePoints + stroke.pts.length > H.LIMITS.strokeRangePoints) {
                syncNotice('The drawing is waiting for a missing update. Retry room sync.', true);
                return;
            }
            futureStrokes.set(key, item); futureStrokePoints += stroke.pts.length;
            return;
        }
        applyDrawingMessage(message);
        tryPendingRecovery();
    }
    async function sendHello(to, reply = false) {
        const socket = app.ws, id = app.myId, request = app.snapshotRequest;
        const hostHello = app.isHost
            ? await signHost({ kind: 'hello', from: id, request }) : undefined;
        if (app.ended || app.ws !== socket || !app.connected || app.myId !== id || app.snapshotRequest !== request) return;
        await send({ type: 'hello', ...(to ? { to } : {}), ...(reply ? { reply: true } : {}),
            name: app.name, av: avFlags(), protocol: 2, snapshotRequest: request, hostHello });
    }
    async function confirmedHostHello(msg, meta) {
        const signed = msg.hostHello;
        if (app.isHost || signed?.body?.kind !== 'hello' || signed.body.from !== meta.from
            || !S.validNonce(signed.body.request) || !await verifyHost(signed)
            || !relayCurrent(meta) || !meta.peer.live) return false;
        const changed = app.knownHostId !== meta.from;
        app.knownHostId = meta.from;
        if (changed && (!recovery || recovery.complete || recovery.failed)) beginRecovery(meta.socket);
        if (recovery && !recovery.complete && !recovery.failed && recovery.askedHost !== meta.from) {
            recovery.askedHost = meta.from;
            return true;
        }
        return false;
    }
    ui.syncRetry.addEventListener('click', () => {
        if (!app.connected || app.ended) return;
        beginRecovery(app.ws);
        void sendHello();
    });
    function commitRecovered(snapshot, context, meta, provenSeq = 0) {
        if (!recoveryCurrent(context, meta)) return;
        const pending = { snapshot, meta, provenSeq };
        if (context.pendingSnapshot?.snapshot.trusted && !snapshot.trusted) return;
        if (authorityWork.size) {
            context.pendingSnapshot = pending;
            if (!context.authorityWait) {
                context.authorityWait = true;
                void Promise.allSettled([...authorityWork]).then(() => {
                    context.authorityWait = false;
                    if (recovery === context) tryPendingRecovery();
                });
            }
            return;
        }
        // Include an unfinished local stroke before replacing the canvas. Its
        // absolute offsets make a later paced delivery idempotent at peers.
        flush();
        let incoming = snapshot;
        if (!snapshot.trusted) {
            // A peer may share drawing, but cannot assert fresh host controls.
            incoming = { ...snapshot, seq: Math.max(context.seqFloor, app.lastHostSeq, provenSeq, snapshot.epoch),
                video: app.lastVideoSigned,
                mods: [app.av.mods.lock, app.av.mods.spot].filter(Boolean) };
        }
        const result = context.journal.merge(incoming, {
            state: app.state, lastVideoSigned: app.lastVideoSigned, lastClearSigned: app.lastClearSigned,
            mods: app.av.mods, lastHostSeq: app.lastHostSeq, drawingEpoch: app.drawingEpoch,
            preserveDrawing: app.isHost && !snapshot.trusted
        });
        if (!result.ok) {
            if (['unproved-epoch', 'unresolved-stroke-gap'].includes(result.error)) {
                context.pendingSnapshot = pending;
                return;
            }
            failRecovery(context, result.error === 'legacy-stroke'
                ? 'An older room tab is drawing. Refresh those tabs, then retry room sync.' : undefined);
            return;
        }
        const next = result.candidate;
        const ranges = applyDeferredStrokes(next.state, next.drawingEpoch, false);
        if (ranges.pendingPoints) { context.pendingSnapshot = pending; return; }
        if (ranges.conflicted || ranges.exhausted) { failRecovery(context); return; }
        context.pendingSnapshot = null;
        app.state = next.state;
        app.lastHostSeq = next.lastHostSeq;
        app.lastVideoSigned = next.lastVideoSigned;
        app.lastClearSigned = next.lastClearSigned;
        app.drawingEpoch = next.drawingEpoch;
        applyDeferredStrokes();
        for (const signed of [next.mods.lock, next.mods.spot].filter(Boolean)) applyHostAction(signed.body, signed, false);
        redraw(); renderChat(); showEpisode();
        void syncToState(true);
        app.snapshotDone = true; app.snapshotFrom = meta.from;
        app.snapshotHasSeqProof = snapshot.trusted || provenSeq > 0;
        if (snapshot.trusted || app.isHost) {
            finishRecovery(context, true, meta.from, true);
        } else {
            context.peerApplied = true;
            syncNotice('The drawing is shared. Waiting for the host to confirm room controls…');
        }
    }
    async function receiveSnapshot(message, meta) {
        const context = recovery;
        if (!recoveryCurrent(context, meta) || message.request !== context.request) return;
        const options = { to: context.to, request: context.request,
            seqFloor: context.seqFloor, epochFloor: context.epochFloor };
        try {
            if (Object.hasOwn(message, 'lastHostSeqSigned')) {
                const part = await S.verifyPart(message, options, verifyHost);
                if (!recoveryCurrent(context, meta)) return;
                if (!context.fresh) context.fresh = S.createAssembly(options);
                const snapshot = context.fresh.add(part);
                if (snapshot) {
                    commitRecovered(snapshot, context, meta);
                    if (context.complete) app.lastSnapshotProof = part.lastHostSeqSigned;
                }
                return;
            }
            const part = S.parsePeerPart(message, options);
            if (part.epoch && !(await verifyHost(part.clear))) return;
            if (!recoveryCurrent(context, meta)) return;
            let provenSeq = 0;
            const proof = message.peerHostSeqProof;
            if (proof && Number.isSafeInteger(proof.body?.seq) && proof.body.seq >= 0 && await verifyHost(proof)) provenSeq = proof.body.seq;
            if (!recoveryCurrent(context, meta) || context.peerApplied) return;
            if (!context.peers.has(meta.from)) {
                if (context.peers.size >= 12) return;
                context.peers.set(meta.from, { assembly: S.createAssembly({ ...options, peer: true }), provenSeq });
            }
            const peer = context.peers.get(meta.from);
            peer.provenSeq = Math.max(peer.provenSeq, provenSeq);
            const snapshot = peer.assembly.add(part);
            if (snapshot) commitRecovered(snapshot, context, meta, peer.provenSeq);
        } catch (_) {
            // Untrusted, stale and malformed packets never downgrade into the
            // old snapshot path or replace any currently displayed activity.
        }
    }
    function connect() {
        if (app.ended) return;
        if (!relayBase) {
            setGate('The room server isn’t switched on yet. Nothing to join.');
            return;
        }
        const url = `${relayBase.replace(/\/$/, '')}/room?room=${app.roomId}&preview=${encodeURIComponent(previewKey)}`;
        setGate('Connecting…');
        const ws = new WebSocket(url);
        app.ws = ws;
        const incoming = new Set();
        inboundWork.set(ws, incoming);
        ws.onmessage = (event) => {
            const work = { peer: null, type: null, task: null };
            const task = work.task = onRelay(event.data, ws, work);
            incoming.add(work);
            void task.then(() => incoming.delete(work), () => incoming.delete(work));
            return task;
        };
        ws.onclose = (event) => {
            if (app.ws !== ws) return;
            retireRelayPeers();
            clearTimeout(pace.timer); pace.timer = 0;
            pace.queue = pace.queue.filter((item) => !item.socket);
            app.connected = false;
            staffReportDisconnected(ws);
            // Scrollback belongs to this live connection. Retained outbound
            // envelopes and the unsent composer draft remain separate.
            app.state.chat = [];
            ui.log.replaceChildren();
            cancelRecovery();
            app.lastClose = event.code;
            // Dropped mid-hang (Wi-Fi blip, phone switching networks): retry a few times with backoff.
            if (app.myId && event.code !== 4429 && event.code < 4400 && app.retries < 5) {
                app.retries += 1;
                say(`Lost the room for a sec. Reconnecting (${app.retries}/5)…`);
                Array.from(app.av.pcs.keys()).forEach(closePc);
                app.av.peers.clear();
                reconnectTimer = win.setTimeout(connect, Math.min(8000, 500 * 2 ** app.retries));
                return;
            }
            const why = event.code === 4401 ? 'Your private invitation or sign-in expired. Reopen your invitation and sign in again.'
                : event.code === 4429 ? 'You’ve hit this room’s message limit for today.'
                : app.myId ? 'Lost the room. Reload to get back in.'
                    : 'Couldn’t get in. The link may be wrong, the room may be full, or the room server is resting for today.';
            endSession(why);
        };
    }

    function endSession(reason) {
        app.ended = true; app.connected = false;
        cancelRecovery();
        for (const job of snapshotJobs.values()) clearTimeout(job.timer);
        snapshotJobs.clear();
        futureStrokes.clear(); futureStrokePoints = 0;
        sealingStrokes.clear();
        retireRelayPeers();
        app.ws.onmessage = null;
        clearTimeout(reconnectTimer); clearTimeout(pace.timer); clearTimeout(flushTimer);
        clearTimeout(videoPublishTimer); clearInterval(videoSyncTimer);
        pace.queue = []; pace.timer = 0; pending = []; live = null;
        stopPreCheck(); stopAv(true); turnClient?.stop();
        app.av.peers.clear(); app.av.opening.clear(); app.av.ice = null;
        app.names.clear(); app.state = H.emptyState(); app.lastVideoSigned = null;
        app.privateReports = false;
        receivedChatOrigins = new WeakMap();
        clearStaffReport();
        if (ui.reportDialog.open) ui.reportDialog.close();
        staffReport.opener = null;
        youtube.cancel(); player.yt = null;
        ui.file.pause(); ui.file.removeAttribute('src'); ui.file.load();
        player.kind = null; player.currentKey = ''; player.readyKey = ''; player.failedKey = ''; player.autoplayBlocked = false;
        ui.videoStatus.hidden = true; ui.videoStatus.textContent = '';
        ui.tap.hidden = true;
        ui.log.replaceChildren(); ui.tiles.replaceChildren(); ui.text.value = ''; ui.url.value = '';
        ui.peers.textContent = ''; ui.turnStatus.textContent = ''; redraw();
        ui.room.hidden = true; ui.gate.hidden = false; ui.enter.disabled = true;
        setGate(reason); say(reason);
    }

    async function onRelay(raw, ws, work) {
        if (app.ended || app.ws !== ws) return;
        let frame;
        try { frame = JSON.parse(raw); } catch (error) { return; }
        if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return;
        if (Object.hasOwn(frame, 'privateReport')) { receiveStaffReportAck(frame.privateReport, ws); return; }
        if (Number.isFinite(frame.t)) app.clock.sample(frame.t);
        if (frame.welcome) {
            const again = Boolean(app.myId);
            const oldId = app.myId;
            app.myId = frame.id;
            app.connected = true;
            app.privateReports = frame.privateReports === true;
            updateReportControls();
            app.retries = 0;
            if (again) { say('Back in.'); app.av.wantSent.clear(); } else enterRoom();
            beginRecovery(ws);
            showPeers(frame.peers);
            await sendHello();
            if (again && oldId !== frame.id) await send({ type: 'gone', id: oldId });
            if (app.isHost && frame.peers <= 1) finishOwnRecovery();
            const context = recovery;
            win.setTimeout(() => {
                if (context && recovery === context && app.ws === ws && app.connected) app.snapshotDone = true;
            }, 1500);
            return;
        }
        if (frame.slow) { say('Whoa, slow down a sec.'); return; }
        if (Number.isFinite(frame.peers) && !frame.c) {
            if (frame.left) {
                retireRelayPeer(frame.left);
                app.names.delete(frame.left);
                noteAv(frame.left, null);
                closePc(frame.left);
            }
            showPeers(frame.peers);
            return;
        }
        if (!frame.c) return;
        let peer = relayPeers.get(frame.from);
        if (!peer) { peer = { live: true, received: 0, avReceived: 0, nameReceived: 0 }; relayPeers.set(frame.from, peer); }
        work.peer = peer;
        const received = ++peer.received;
        // Reserve order before decrypting an opaque frame. Native decryption
        // and signature checks can finish out of order; persistent host actions
        // still have to reach their shared replay floor in relay order. Chat,
        // drawing and media continue independently of authority verification.
        const before = inboundAuthority.get(ws) || Promise.resolve();
        let decoded, applied;
        const ready = new Promise(resolve => { decoded = resolve; });
        const done = new Promise(resolve => { applied = resolve; });
        inboundAuthority.set(ws, before.then(() => ready).then(isHost => isHost ? done : undefined));
        let msg;
        try {
            try { msg = await H.open(app.key, frame); } catch (error) { decoded(false); return; }
            work.type = msg?.type;
            decoded(msg?.type === 'host');
            if (msg?.type === 'host') await before;
            if (app.ended || app.ws !== ws) return;
            if (msg.type === 'chat' && (!app.connected || ws.readyState !== 1)) return;
            // Crypto may finish after the relay has already announced departure.
            // Keep prior chat/drawing, but never restore that person's name or media.
            if (!peer.live && ['hello', 'av', 'rtc'].includes(msg.type)) return;
            await handle(msg, { t: frame.t, from: frame.from, peer, received, socket: ws });
        } finally {
            decoded(false); applied();
        }
    }

    function pruneNames() { /* names are refreshed by hello/bye messages */ }

    function showPeers(n) {
        const names = Array.from(app.names.values());
        const count = Number(n) || 1;
        ui.peers.textContent = count <= 1 ? 'Just you' : `${count} here${names.length ? `: ${names.slice(0, 5).join(', ')} + you` : ''}`;
    }

    async function handle(msg, meta) {
        if (msg.to && msg.to !== app.myId) return;
        switch (msg.type) {
        case 'hello': {
            if (meta.received > meta.peer.nameReceived) {
                meta.peer.nameReceived = meta.received;
                app.names.set(meta.from, String(msg.name || 'Someone').slice(0, 24));
            }
            showPeers(app.names.size + 1);
            if (meta.received > meta.peer.avReceived) {
                meta.peer.avReceived = meta.received;
                noteAv(meta.from, msg.av);
            } else if (app.av.peers.has(meta.from) && !app.av.pcs.has(meta.from)) {
                // A newer AV update may arrive before this hello supplies a name.
                openPc(meta.from);
            }
            const askHost = await confirmedHostHello(msg, meta);
            if (!relayCurrent(meta) || !meta.peer.live) return;
            if (!msg.reply || askHost) await sendHello(meta.from, true);
            if (!relayCurrent(meta) || !meta.peer.live) return;
            if (!msg.reply || app.isHost && S.validNonce(msg.snapshotRequest)) scheduleSnapshot(meta.from, msg.snapshotRequest);
            return;
        }
        case 'bye':
            app.names.delete(meta.from);
            noteAv(meta.from, null);
            closePc(meta.from);
            showPeers(app.names.size + 1);
            return;
        case 'snapshot': {
            if (Object.hasOwn(msg, 'request') || msg.lastHostSeqSigned?.body?.kind === 'snapshot') {
                await receiveSnapshot(msg, meta);
                return;
            }
            const seqSigned = msg.lastHostSeqSigned;
            const hasSeqProof = Boolean(
                seqSigned
                && Number.isFinite(seqSigned.body?.seq)
                && await verifyHost(seqSigned)
            );
            if (!relayCurrent(meta)) return;
            if (app.snapshotDone) {
                if (!(hasSeqProof && !app.snapshotHasSeqProof)) return;
            }
            if (msg.first && hasSeqProof && app.snapshotDone && !app.snapshotHasSeqProof) {
                app.snapshotDone = false;
            }
            if (app.snapshotFrom && meta.from !== app.snapshotFrom) {
                if (!app.snapshotHasSeqProof && hasSeqProof) app.snapshotFrom = meta.from;
                else return;
            }
            if (!app.snapshotFrom) app.snapshotFrom = meta.from;
            if (hasSeqProof) {
                app.lastHostSeq = Math.max(app.lastHostSeq, seqSigned.body.seq);
                app.snapshotHasSeqProof = true;
            }
            const finishing = msg.done || !msg.chunk;
            if (finishing) app.snapshotDone = true;
            H.apply(app.state, {
                type: 'snapshot',
                state: { strokes: msg.strokes, video: app.state.video, append: Boolean(msg.chunk && !msg.first) }
            });
            if (
                msg.video?.signed?.body?.kind === 'video'
                && await verifyHost(msg.video.signed) && relayCurrent(meta)
            ) {
                const signedT = Number(msg.video.signed.body.t);
                if (Number.isFinite(signedT)) acceptVideo(msg.video.signed, signedT);
            }
            if (finishing) {
                for (const mod of (Array.isArray(msg.mods) ? msg.mods.slice(0, 4) : [])) {
                    if (mod && V.cleanHostAction(mod.body) && await verifyHost(mod) && relayCurrent(meta)) {
                        if (mod.body.seq < app.lastHostSeq) continue; // snapshot replay guard
                        applyHostAction(mod.body, mod, false);
                        app.lastHostSeq = Math.max(app.lastHostSeq, mod.body.seq);
                    }
                }
                renderChat();
            }
            redraw();
            return;
        }
        case 'stroke':
            acceptStroke(msg);
            return;
        case 'chat':
            if (H.apply(app.state, msg, meta) === 'chat') receivedChatOrigins.set(app.state.chat[app.state.chat.length - 1], { peer: meta.from });
            renderChat();
            return;
        case 'host':
            if (!['clear', 'video', ...V.HOST_KINDS].includes(msg.body?.kind)) return;
            if (!(await verifyHost(msg)) || !relayCurrent(meta)) return;
            if (!(msg.body.seq > app.lastHostSeq)) return; // replay guard
            app.lastHostSeq = msg.body.seq;
            app.lastHostSigned = msg;
            if (msg.body.kind === 'clear') {
                app.lastClearSigned = msg; app.drawingEpoch = msg.body.seq;
                H.apply(app.state, { type: 'clear' }); applyDeferredStrokes(); redraw(); say('The host wiped the canvas.');
            }
            if (msg.body.kind === 'video') acceptVideo(msg, meta.t);
            if (V.HOST_KINDS.includes(msg.body.kind)) applyHostAction(msg.body, msg, false);
            recordHost(msg, meta.t);
            return;
        case 'av':
            if (meta.received > meta.peer.avReceived) {
                meta.peer.avReceived = meta.received;
                noteAv(meta.from, msg.av);
            }
            return;
        case 'nudge':
            if (app.isHost) say(`${app.names.get(meta.from) || 'Someone'} needs a sec. Hit “Hold up!” to pause for everyone.`);
            return;
        case 'rtc':
            await onRtc(meta.from, msg, meta.peer);
            return;
        case 'gone': {
            // A friend reconnected with a new id: drop their stale face.
            const old = typeof msg.id === 'string' ? msg.id : '';
            // Bound to the same display name so nobody can knock a stranger's face out.
            if (old && old !== meta.from && app.names.get(old) && app.names.get(old) === app.names.get(meta.from)) {
                app.names.delete(old);
                noteAv(old, null);
                closePc(old);
            }
            return;
        }
        case 'want': {
            const entry = app.av.pcs.get(meta.from);
            if (entry && entry.wantHi !== Boolean(msg.hi)) { entry.wantHi = Boolean(msg.hi); entry.hiSince = Date.now(); applyEncoding(); }
            return;
        }
        case 'react': {
            const r = V.cleanReaction(msg.r);
            const lim = V.rateLimit(app.av.peerReacts.get(meta.from), Date.now(), 6, 5000);
            app.av.peerReacts.set(meta.from, lim.times);
            if (r && lim.ok && !app.av.hidden.has(meta.from)) showReaction(meta.from, r);
            return;
        }
        case 'report':
            if (app.isHost && typeof msg.about === 'string') say(`⚠️ ${app.names.get(meta.from) || 'Someone'} reported ${app.names.get(msg.about) || 'someone'}. Tap ⋯ on their tile to mute, turn off their camera or take them off faces.`);
            return;
        default:
        }
    }

    function scheduleSnapshot(to, request) {
        const previous = snapshotJobs.get(to);
        if (previous && previous.socket === app.ws && previous.request === request) return;
        if (previous) clearTimeout(previous.timer);
        const job = { to, request, socket: app.ws, timer: 0 };
        snapshotJobs.set(to, job);
        job.timer = win.setTimeout(() => { void sendSnapshot(job); }, app.isHost ? 0 : 150 + Math.random() * 400);
    }
    function snapshotJobCurrent(job) {
        return !app.ended && app.connected && app.ws === job.socket && job.socket.readyState === 1
            && snapshotJobs.get(job.to) === job;
    }
    async function settleState(job) {
        if (app.isHost && recovery && !recovery.complete && !await recovery.ready) return false;
        while (snapshotJobCurrent(job)) {
            const pending = [...(inboundWork.get(job.socket) || [])]
                // A departed identity's presence/media verification cannot
                // change a captured canvas and must not block its replacement.
                .filter(work => !work.peer || work.peer.live || !['hello', 'av', 'rtc'].includes(work.type))
                .map(work => work.task);
            pending.push(...authorityWork);
            if (!pending.length) return true;
            let wake;
            const retired = new Promise(resolve => { wake = resolve; retirementWaiters.add(resolve); });
            try {
                // Recheck known presence work when its identity leaves, even
                // if its native verification has not finished yet.
                await Promise.race([Promise.allSettled(pending), retired]);
            } finally { retirementWaiters.delete(wake); }
        }
        return false;
    }
    function bestHostProof() {
        return [app.lastHostSigned, app.lastClearSigned, app.lastVideoSigned?.signed,
            app.av.mods.lock, app.av.mods.spot, app.lastSnapshotProof]
            .filter(proof => Number.isSafeInteger(proof?.body?.seq))
            .sort((a, b) => b.body.seq - a.body.seq)[0] || null;
    }
    async function sendSnapshot(job) {
        if (!await settleState(job) || !snapshotJobCurrent(job)) return;
        const status = H.strokeRangeStatus(app.state);
        if (status.pendingPoints || status.exhausted || status.conflicted) {
            syncNotice('The drawing is missing a piece. Retry room sync.', true);
            return;
        }
        if (!S.validNonce(job.request)) {
            await sendLegacySnapshot(job);
            return;
        }
        try {
            // makeChunks clones synchronously after inbound and local authority
            // transactions settle. Later input cannot change the signed cut.
            const seq = app.lastHostSeq;
            const proof = bestHostProof();
            const parts = S.makeChunks({ to: job.to, request: job.request, seq,
                epoch: app.drawingEpoch, clear: app.lastClearSigned,
                strokes: app.state.strokes.map(H.cleanSnapshotStroke),
                video: app.lastVideoSigned, mods: [app.av.mods.lock, app.av.mods.spot].filter(Boolean) });
            for (const part of parts) {
                let packet;
                if (app.isHost) {
                    const body = await S.proofBody(part, seq);
                    const signed = await signHost(body);
                    packet = { ...part, lastHostSeqSigned: signed };
                } else packet = { ...part, peerHostSeqProof: proof };
                if (!snapshotJobCurrent(job)) return;
                await send(packet);
            }
        } catch (_) {
            if (snapshotJobCurrent(job)) syncNotice('The drawing could not be shared safely. Save it or retry room sync.', true);
        }
    }
    async function sendLegacySnapshot(job) {
        const to = job.to;
        const video = app.lastVideoSigned;
        const mods = [app.av.mods.lock, app.av.mods.spot].filter(Boolean);
        const strokes = app.state.strokes.slice(-400);
        const chunks = [];
        for (let i = 0; i < strokes.length; i += 100) chunks.push(strokes.slice(i, i + 100));
        if (!chunks.length) chunks.push([]);
        let lastHostSeqSigned = null;
        if (app.isHost) {
            lastHostSeqSigned = await signHost({ kind: 'seq', seq: app.lastHostSeq });
        } else if (app.lastHostSigned && Number.isFinite(app.lastHostSigned.body?.seq)) {
            lastHostSeqSigned = app.lastHostSigned;
        }
        for (let i = 0; i < chunks.length; i += 1) {
            if (!snapshotJobCurrent(job)) return;
            const chunk = chunks[i];
            const isLast = i === chunks.length - 1;
            await send({
                type: 'snapshot',
                to,
                strokes: chunk,
                video: isLast ? video : undefined,
                mods: isLast ? mods : undefined,
                lastHostSeqSigned: lastHostSeqSigned || undefined,
                chunk: chunks.length > 1,
                first: i === 0,
                done: isLast
            });
        }
    }

    /* ---------------- gate / enter ---------------- */
    function enterRoom() {
        stopPreCheck();
        ui.gate.hidden = true;
        ui.room.hidden = false;
        doc.body.classList.toggle('is-host', app.isHost);
        ui.hostNote.textContent = app.isHost ? 'You started this room, so you drive the video and the wipe.' : 'The person who started the room drives the video.';
        say('You’re in. Say hi?');
        iceServers();
        sizeCanvas();
    }

    async function start() {
        let invite = readInvite();
        if (!previewKey) {
            ui.gateTitle.textContent = 'Not open yet';
            ui.gateCopy.textContent = 'This room isn’t open to the public. Ask whoever sent you here for the full link.';
            ui.enter.hidden = true;
            ui.name.closest('label').hidden = true;
            return;
        }
        if (invite) {
            ui.gateTitle.textContent = 'You’re invited';
            ui.gateCopy.textContent = 'Somebody wants to hang out. Pick a name (or don’t) and jump in.';
            ui.enter.textContent = 'Jump in';
        }
        // Blank by default, remembered on this device; 🎲 fills in a fun name you can edit or reroll.
        try { ui.name.value = localStorage.getItem('hangout-nick') || ''; } catch (error) { /* private mode */ }
        const dice = $('[data-dice]');
        if (dice) dice.addEventListener('click', () => {
            const r = window.StaleNames.roll();
            ui.name.value = r.name;
            dice.textContent = '🎲 Roll again';
            document.querySelector('[data-gate-status]').textContent = r.legendary ? '✨ LEGENDARY name! Keep it, it’s rare.' : '';
            ui.name.focus();
        });
        ui.enter.addEventListener('click', async () => {
            const typed = (ui.name.value || '').replace(/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 24);
            if (typed.length < 2) { document.querySelector('[data-gate-status]').textContent = 'Type a name (or tap 🎲 for a fun one).'; ui.name.focus(); return; }
            try { localStorage.setItem('hangout-nick', typed); } catch (error) { /* private mode */ }
            ui.enter.disabled = true;
            app.name = typed;
            try {
                if (!invite) invite = await makeRoom();
                await loadIdentity(invite);
                connect();
            } catch (error) {
                setGate('That invite link looks broken. Ask for a fresh one.');
                ui.enter.disabled = false;
            }
        });
        if (invite && params.get('autojoin') === '1') ui.enter.click();
    }

    ui.copy.addEventListener('click', async () => {
        const link = win.location.href;
        try {
            if (navigator.share && /Mobi/.test(navigator.userAgent)) await navigator.share({ title: 'Hang out with Stalemate', url: link });
            else { await navigator.clipboard.writeText(link); say('Invite copied. Text it to your people.'); }
        } catch (error) { win.prompt('Copy this invite link:', link); }
    });

    win.addEventListener('beforeunload', () => { try { send({ type: 'bye' }); } catch (error) { /* closing */ } });

    /* ---------------- chat ---------------- */
    ui.say.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!app.connected) { say('Reconnecting. Your draft stays here until you can send it.'); return; }
        const text = ui.text.value.trim();
        if (!text) return;
        ui.text.value = '';
        const msg = { type: 'chat', name: app.name, text };
        H.apply(app.state, msg, { t: app.clock.relayNow() });
        renderChat();
        await send(msg);
    });

    function renderChat() {
        ui.log.textContent = '';
        for (const line of app.state.chat.slice(-100)) {
            const li = doc.createElement('li');
            const b = doc.createElement('b');
            b.textContent = `${line.name}: `;
            li.append(b, doc.createTextNode(line.text));
            if (app.privateReports && receivedChatOrigins.has(line)) {
                const report = doc.createElement('button');
                report.type = 'button'; report.className = 'btn btn--ghost'; report.dataset.messageReport = '';
                report.textContent = 'Report to staff';
                report.setAttribute('aria-label', `Report this message from ${line.name} to community staff`);
                report.addEventListener('click', () => openStaffReport({ line }, report));
                li.append(report);
            }
            ui.log.append(li);
        }
        ui.log.scrollTop = ui.log.scrollHeight;
    }

    /* ---------------- drawing ---------------- */
    const ctx = ui.canvas.getContext('2d');
    let color = H.COLORS[1];
    function pickColor(c) {
        color = c;
        doc.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-pressed', String(s.dataset.color === c)));
    }
    function addSwatch(parent, c, name) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'swatch';
        b.dataset.color = c;
        b.style.background = c;
        b.title = name;
        b.setAttribute('aria-label', name);
        b.setAttribute('aria-pressed', String(c === color));
        b.addEventListener('click', () => pickColor(c));
        parent.append(b);
    }
    H.COLORS.slice(0, 8).forEach((c, i) => addSwatch(ui.swatches, c, `Color ${i + 1}`));
    BOB.PALETTE.forEach((p) => addSwatch(ui.bobPalette, p.hex, p.name));
    function pickBrush(size) {
        ui.size.value = String(size);
        ui.bobBrushes.querySelectorAll('.brush').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.size) === size)));
    }
    BOB.BRUSHES.forEach((br) => {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'brush';
        b.dataset.size = String(br.size);
        b.textContent = br.name;
        b.title = br.hint;
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => pickBrush(br.size));
        ui.bobBrushes.append(b);
    });
    ui.size.addEventListener('input', () => pickBrush(Number(ui.size.value)));

    function sizeCanvas() { redraw(); }
    function drawStroke(stroke, fromIndex = 0) {
        if (!stroke) return;
        const w = ui.canvas.width;
        const h = ui.canvas.height;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size * (w / 1200);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        const pts = stroke.pts;
        const s = Math.max(0, fromIndex - 1);
        ctx.moveTo(pts[s][0] * w, pts[s][1] * h);
        if (pts.length === 1) ctx.lineTo(pts[0][0] * w + 0.1, pts[0][1] * h);
        for (let i = s + 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0] * w, pts[i][1] * h);
        ctx.stroke();
    }
    function redraw() {
        ctx.fillStyle = '#f4f0e6';
        ctx.fillRect(0, 0, ui.canvas.width, ui.canvas.height);
        app.state.strokes.forEach((s) => drawStroke(s));
    }

    let live = null;
    let pending = [];
    let flushTimer = null;
    function point(event) {
        const r = ui.canvas.getBoundingClientRect();
        return [Math.min(1, Math.max(0, (event.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (event.clientY - r.top) / r.height))]
            .map(value => Math.round(value * 10000) / 10000);
    }
    function flush() {
        flushTimer = null;
        if (!live || !pending.length) return;
        if (live.epoch !== app.drawingEpoch) { pending = []; return; }
        const message = { type: 'stroke', offset: live.sent, epoch: live.epoch,
            stroke: { id: live.id, color: live.color, size: live.size, pts: pending } };
        live.sent += pending.length;
        recordStroke(message);
        void send(message);
        pending = [];
    }
    ui.canvas.addEventListener('pointerdown', (event) => {
        if (!app.connected) { say('Reconnecting. Drawing resumes when you are back in.'); return; }
        ui.canvas.setPointerCapture(event.pointerId);
        live = { id: H.newSecret(), color, size: Number(ui.size.value), pts: [point(event)], sent: 0, epoch: app.drawingEpoch };
        pending = [live.pts[0]];
        H.apply(app.state, { type: 'stroke', stroke: { ...live } });
        drawStroke(app.state.strokes[app.state.strokes.length - 1]);
    });
    ui.canvas.addEventListener('pointermove', (event) => {
        if (!live || !app.connected) return;
        const p = point(event);
        const mine = app.state.strokes.find((s) => s.id === live.id);
        if (!mine || mine.pts.length > H.LIMITS.strokePoints * 8 - 1) return;
        mine.pts.push(p);
        pending.push(p);
        drawStroke(mine, mine.pts.length - 1);
        if (pending.length >= H.LIMITS.strokePoints) flush();
        else if (!flushTimer) flushTimer = win.setTimeout(flush, 120);
    });
    const endStroke = () => { if (live) { flush(); live = null; } };
    ui.canvas.addEventListener('pointerup', endStroke);
    ui.canvas.addEventListener('pointercancel', endStroke);

    ui.clear.addEventListener('click', async () => {
        if (!app.isHost || !app.connected) return;
        await hostWork(async () => {
            const seq = app.lastHostSeq = Math.max(app.lastHostSeq + 1, Date.now());
            app.drawingEpoch = seq;
            H.apply(app.state, { type: 'clear' });
            redraw();
            const signed = await signHost({ kind: 'clear', seq });
            if (app.ended || seq !== app.drawingEpoch) return;
            app.lastClearSigned = signed;
            applyDeferredStrokes();
            recordHost(signed, app.clock.relayNow());
            await send(signed);
        });
    });
    ui.save.addEventListener('click', () => {
        const a = doc.createElement('a');
        a.download = 'stalemate-hangout.png';
        a.href = ui.canvas.toDataURL('image/png');
        a.click();
    });

    /* ---------------- synced video (host drives) ---------------- */
    const player = { kind: null, yt: null, loading: null, applying: 0, currentKey: '', readyKey: '', failedKey: '', autoplayBlocked: false };
    let videoPublishTimer;
    const youtube = win.HangoutYouTube.create({
        getElement: () => ui.yt, setElement: (element) => { ui.yt = element; },
        onStateChange: onYtState, onAutoplayBlocked: onYtAutoplayBlocked,
        onError: () => videoFailure(player.currentKey)
    });

    function videoFailure(key) {
        if (app.ended || player.currentKey !== key || player.kind !== 'yt') return;
        player.yt = null; player.readyKey = ''; player.failedKey = key; player.autoplayBlocked = false;
        ui.videoStatus.textContent = 'YouTube couldn’t load. Retry video when you’re ready.';
        ui.videoStatus.hidden = false;
        ui.tap.textContent = 'Retry video'; ui.tap.hidden = false;
    }

    async function ensureSource(source, retry = false) {
        if (app.ended || (source.kind !== 'file' && source.kind !== 'yt')) return false;
        if (source.kind === 'yt' && !/^[A-Za-z0-9_-]{11}$/.test(source.id || '')) return false;
        if (source.kind === 'file' && !H.FILE_SOURCES[source.id]) return false;
        const key = `${source.kind}:${source.id}`;
        if (player.currentKey === key) {
            if (player.failedKey === key && !retry) return false;
            if (player.loading) return player.loading;
            if (player.readyKey === key) return true;
        }
        player.currentKey = key;
        player.readyKey = ''; player.failedKey = ''; player.loading = null;
        player.autoplayBlocked = false;
        ui.tap.hidden = true; ui.tap.textContent = 'Tap to sync in';
        ui.videoStatus.hidden = true; ui.videoStatus.textContent = '';
        player.kind = source.kind;
        if (source.kind === 'file') {
            youtube.cancel(); player.yt = null;
            ui.yt.hidden = true;
            ui.file.hidden = false;
            ui.file.src = H.FILE_SOURCES[source.id].src;
            player.readyKey = key;
            return true;
        }
        ui.file.pause();
        ui.file.hidden = true;
        ui.yt.hidden = false;
        player.yt = null;
        ui.videoStatus.textContent = 'Loading YouTube…'; ui.videoStatus.hidden = false;
        const loading = (async () => {
            try {
                const instance = await youtube.select(source.id);
                if (!instance || app.ended || player.currentKey !== key) return false;
                player.yt = instance; player.readyKey = key;
                ui.videoStatus.hidden = true; ui.videoStatus.textContent = '';
                return true;
            } catch (_) { videoFailure(key); return false; }
        })();
        player.loading = loading;
        try { return await loading; }
        finally { if (player.loading === loading) player.loading = null; }
    }

    function localTime() {
        if (player.kind === 'file') return ui.file.currentTime || 0;
        if (player.kind === 'yt' && player.yt && player.yt.getCurrentTime) return player.yt.getCurrentTime() || 0;
        return 0;
    }
    function localPlaying() {
        if (player.kind === 'file') return !ui.file.paused;
        if (player.kind === 'yt' && player.yt && player.yt.getPlayerState) return player.yt.getPlayerState() === 1;
        return false;
    }
    function hold(fn) {
        player.applying = Date.now() + 900;
        fn();
    }
    function seekTo(s) { hold(() => { if (player.kind === 'file') ui.file.currentTime = s; else if (player.yt) player.yt.seekTo(s, true); }); }
    function playLocal() {
        hold(() => {
            let p;
            if (player.kind === 'file') p = ui.file.play();
            else if (player.yt) player.yt.playVideo();
            if (p && p.catch) p.catch(() => { ui.tap.hidden = false; });
        });
    }
    function pauseLocal() { hold(() => { if (player.kind === 'file') ui.file.pause(); else if (player.yt) player.yt.pauseVideo(); }); }

    async function acceptVideo(signed, t) {
        if (app.ended) return;
        const b = signed.body;
        const relayT = Number.isFinite(Number(b.t)) ? Number(b.t) : t;
        if (H.apply(app.state, { type: 'video', source: b.source, playing: b.playing, pos: b.pos }, { t: relayT }) !== 'video') return;
        app.lastVideoSigned = { signed, t: relayT };
        app.lastHostSeq = Math.max(app.lastHostSeq, b.seq || 0);
        showEpisode();
        await syncToState(true);
    }

    async function syncToState(force, retry = false) {
        const v = app.state.video;
        if (!v) return;
        if (!await ensureSource(v.source, retry)) return;
        if (app.ended || app.state.video !== v) return;
        if (!v.playing) { player.autoplayBlocked = false; ui.tap.hidden = true; }
        else if (player.autoplayBlocked && !force) return;
        const want = H.expectedPosition(v, app.clock.relayNow());
        if (force || H.needsCorrection(localTime(), want)) seekTo(want);
        if (v.playing && !localPlaying()) playLocal();
        if (!v.playing && localPlaying()) pauseLocal();
    }
    const videoSyncTimer = win.setInterval(() => {
        if (!app.connected) return;
        if (!app.isHost) return syncToState(false);
        const v = app.state.video;
        if (!v || !player.kind || player.autoplayBlocked || player.readyKey !== `${v.source.kind}:${v.source.id}` || Date.now() < player.applying) return;
        // Paused YouTube scrubs can omit onStateChange. Host authority still
        // travels through hostPublish's signed, sequenced video message.
        if (localPlaying() !== v.playing || H.needsCorrection(localTime(), H.expectedPosition(v, app.clock.relayNow()))) {
            hostPublish(v.source, localPlaying(), localTime());
        }
    }, 2000);

    let videoPublication = null;
    async function hostPublish(source, playing, pos) {
        if (!app.connected || !app.isHost) return;
        // A newer video choice can retire an obsolete pending signature. Clear
        // and moderation transactions still run to completion in their order.
        if (videoPublication && !videoPublication.committed) videoPublication.cancel();
        const publication = { cancelled: false, committed: false, cancel: null };
        const cancelled = new Promise(resolve => {
            publication.cancel = () => { publication.cancelled = true; resolve(null); };
        });
        videoPublication = publication;
        return hostWork(async () => {
            if (publication.cancelled || videoPublication !== publication) return false;
            const seq = app.lastHostSeq = Math.max(app.lastHostSeq + 1, Date.now());
            const t = app.clock.relayNow();
            const signed = await Promise.race([
                signHost({ kind: 'video', seq, source, playing, pos: Math.max(0, pos), t }), cancelled
            ]);
            if (!signed || publication.cancelled || videoPublication !== publication
                || !app.connected || app.ended || app.lastHostSeq !== seq) return false;
            publication.committed = true;
            H.apply(app.state, { type: 'video', source, playing, pos }, { t });
            app.lastVideoSigned = { signed, t };
            recordHost(signed, t);
            showEpisode();
            await send(signed);
            return true;
        });
    }

    function onLocalChange() {
        if (!app.connected || !app.isHost || !app.state.video || player.autoplayBlocked) return;
        const v = app.state.video;
        if (player.readyKey !== `${v.source.kind}:${v.source.id}`) return;
        const playing = localPlaying();
        const pos = localTime();
        if (Date.now() < player.applying) {
            const want = v.playing ? H.expectedPosition(v, app.clock.relayNow()) : v.pos;
            if (playing === v.playing && Math.abs(pos - want) < 2) return;
        }
        hostPublish(v.source, playing, pos);
    }
    function onYtAutoplayBlocked() {
        const v = app.state.video;
        if (app.ended || player.kind !== 'yt' || localPlaying() || !v?.playing || v.source.kind !== 'yt'
            || player.readyKey !== `${v.source.kind}:${v.source.id}`) return;
        // YouTube playVideo() returns void; policy denial is a separate event.
        // Keep the shared play request until a real user gesture starts playback.
        player.autoplayBlocked = true;
        ui.tap.hidden = false;
    }
    function onYtState(event) {
        if (app.ended) return;
        if (event.data === 1 && player.kind === 'yt') { player.autoplayBlocked = false; ui.tap.hidden = true; }
        if (event.data !== 1 && event.data !== 2) return;
        clearTimeout(videoPublishTimer);
        videoPublishTimer = win.setTimeout(onLocalChange, 100);
    }
    ['play', 'pause', 'seeked'].forEach((e) => ui.file.addEventListener(e, onLocalChange));
    ui.tap.addEventListener('click', () => { if (player.kind !== 'yt') ui.tap.hidden = true; syncToState(true, true); });

    async function hostLoad(source) {
        if (!app.isHost) { say('Only the person who started the room changes the video.'); return; }
        player.readyKey = ''; // Stop old player events while the new intent is signed.
        // Choosing a video is an explicit host action. Loading failures remain
        // local and cannot later replace a newer shared selection.
        if (await hostPublish(source, true, 0)) await syncToState(true, true);
    }
    ui.load.addEventListener('submit', (event) => {
        event.preventDefault();
        const id = H.parseYouTubeId(ui.url.value);
        if (!id) { say('That doesn’t look like a YouTube link.'); return; }
        ui.url.value = '';
        hostLoad({ kind: 'yt', id });
    });
    ui.picks.addEventListener('click', (event) => {
        const b = event.target.closest('button');
        if (!b) return;
        if (b.dataset.pickFile) hostLoad({ kind: 'file', id: b.dataset.pickFile });
        if (b.dataset.pickYt) hostLoad({ kind: 'yt', id: b.dataset.pickYt });
    });

    /* ---------------- faces & voices: opt-in P2P mesh (Webex-style basics) ----------------
     * Media goes browser to browser (DTLS-SRTP), signaling rides the encrypted relay.
     * Every receiver has its own sender, so people only get our sharp feed when they're
     * watching us big (speaker view, pin, spotlight); everyone else gets a thumbnail. */
    function avFlags() {
        return { mic: app.av.mic, cam: app.av.cam, canvas: app.av.canvas, screen: Boolean(app.av.screen), hand: app.av.hand, away: app.av.away };
    }
    function avCount() { return app.av.peers.size + ((app.av.mic || app.av.cam) ? 1 : 0); }
    function camCount() { return app.av.camPeers.size + (app.av.cam ? 1 : 0); }
    function peerName(id) { return id === 'me' ? `${app.name} (you)` : (app.names.get(id) || 'Friend'); }

    function pruneStreamTracks(stream) {
        if (!stream) return;
        stream.getTracks().filter((t) => t.readyState === 'ended').forEach((t) => stream.removeTrack(t));
    }

    function noteAv(from, av) {
        if (app.av.removed.has(from)) av = null;
        const on = Boolean(av && (av.mic || av.cam));
        if (on && !app.av.peers.has(from) && app.av.locked) { app.av.lockedOut.add(from); return; }
        app.av.lockedOut.delete(from);
        if (av && av.canvas) app.av.canvasPeers.add(from); else app.av.canvasPeers.delete(from);
        if (av && av.cam) app.av.camPeers.add(from); else app.av.camPeers.delete(from);
        if (av && av.screen) app.av.screenPeers.add(from); else app.av.screenPeers.delete(from);
        if (av && av.mic) app.av.micPeers.add(from); else app.av.micPeers.delete(from);
        if (av && Number.isFinite(av.hand)) app.av.hands[from] = av.hand; else delete app.av.hands[from];
        if (av && av.away) app.av.awayPeers.add(from); else app.av.awayPeers.delete(from);
        if (on) app.av.peers.add(from); else app.av.peers.delete(from);
        if (!on && !(app.av.mic || app.av.cam)) closePc(from);
        if (on && !app.av.pcs.has(from)) openPc(from);
        const entry = app.av.pcs.get(from);
        if (entry && av) {
            if (!av.cam) entry.stream.getVideoTracks().forEach((t) => entry.stream.removeTrack(t));
            else {
                entry.pc.getReceivers().forEach((r) => {
                    if (r.track && !entry.stream.getTracks().includes(r.track)) entry.stream.addTrack(r.track);
                });
            }
            pruneStreamTracks(entry.stream);
        }
        entry?.pumpOffer();
        layout();
    }

    function ask(title, copy, { adult18 = false } = {}) {
        if (ui.ask.open) return Promise.resolve(false);
        return new Promise((resolve) => {
            ui.askTitle.textContent = title;
            const confirmAge = adult18 && !app.av.adult18;
            ui.askCopy.textContent = `${confirmAge ? 'Cameras are for adults 18+. Confirm you are 18 or older to continue. ' : ''}${copy}`;
            ui.askYes.textContent = confirmAge ? 'I’m 18+ — ask my browser' : 'OK, ask my browser';
            const cancel = (event) => { event.preventDefault(); done(false); };
            const done = (v) => {
                ui.ask.close(); ui.askYes.onclick = null; ui.askNo.onclick = null; ui.ask.removeEventListener('cancel', cancel);
                if (v && confirmAge) app.av.adult18 = true;
                resolve(v);
            };
            ui.askYes.onclick = () => done(true);
            ui.askNo.onclick = () => done(false);
            ui.ask.addEventListener('cancel', cancel);
            if (ui.ask.showModal) ui.ask.showModal(); else done(win.confirm(`${title}\n\n${ui.askCopy.textContent}`));
        });
    }

    let turnClient;
    async function iceServers() {
        if (!turnClient) turnClient = win.HangoutTurn.createTurnClient({
            url: turnUrl, preview: previewKey, room: app.roomId,
            getDevice: () => { try { return ''; } catch (_) { return ''; } },
            onStatus: (status) => {
                ui.turnStatus.textContent = status === 'ready' ? 'Video relay available for connections that need it.'
                    : status === 'device-required' ? 'Direct connections only. Join the lobby once on this browser to enable relay access.'
                        : 'Video relay unavailable for now. Direct connections, chat and drawing remain available.';
            },
            onChange: (ice) => {
                app.av.ice = ice;
                for (const { pc } of app.av.pcs.values()) {
                    try { pc.setConfiguration({ ...pc.getConfiguration(), iceServers: ice }); pc.restartIce(); } catch (_) { /* closed peer */ }
                }
            }
        });
        app.av.ice = await turnClient.get();
        return app.av.ice;
    }
    win.addEventListener('pagehide', () => turnClient?.stop());
    win.addEventListener('pageshow', (event) => {
        if (event.persisted && app.roomId) { turnClient = null; iceServers(); }
    });

    function prefs() {
        try { return JSON.parse(localStorage.getItem('hangout-av') || '{}') || {}; } catch (error) { return {}; }
    }
    function savePrefs(patch) {
        try { localStorage.setItem('hangout-av', JSON.stringify(Object.assign(prefs(), patch))); } catch (error) { /* private mode */ }
    }
    function camConstraints() {
        const p = prefs();
        const c = Object.assign({}, CAM);
        if (p.cam) c.deviceId = { ideal: p.cam };
        return c;
    }

    // A permission prompt can outlive leaving the call or host moderation.
    const captureVersion = { audio: 0, video: 0 };
    function keepCapture(kind, version, stream, restore) {
        if (!app.ended && version === captureVersion[kind] && !app.av.kicked && (restore || !(app.av.locked && !(app.av.mic || app.av.cam)))) return true;
        stream.getTracks().forEach((track) => track.stop());
        return false;
    }
    function setTrack(kind, track) {
        if (!app.av.stream) app.av.stream = new MediaStream();
        app.av.stream.getTracks().filter((t) => t.kind === kind).forEach((t) => app.av.stream.removeTrack(t));
        if (track) app.av.stream.addTrack(track);
    }
    function stopRaw(kind) {
        captureVersion[kind] += 1;
        if (kind === 'video') {
            if (app.av.screen) { app.av.screen.stop(); app.av.screen = null; }
            if (app.av.bg.proc) { const p = app.av.bg.proc; app.av.bg.proc = null; p.destroy().catch(() => {}); }
            if (app.av.rawCam) { app.av.rawCam.stop(); app.av.rawCam = null; }
        }
        if (app.av.stream) app.av.stream.getTracks().filter((t) => t.kind === kind).forEach((t) => t.stop());
        setTrack(kind, null);
    }

    async function toggle(kind, restore) {
        if (app.ended) return;
        const turningOn = !app.av[kind] || (kind === 'cam' && Boolean(app.av.screen));
        const mediaKind = kind === 'cam' ? 'video' : 'audio';
        if (kind === 'cam' && app.av.canvas) { await toggleCanvasCam(); return; }
        if (turningOn) {
            if (app.av.kicked) { say('The host took you off faces in this room. Chat and draw still work.'); return; }
            if (!restore && app.av.locked && !(app.av.mic || app.av.cam)) { say('The host locked faces for now. Chat and draw still work.'); return; }
            if (!restore && !(app.av.mic || app.av.cam) && avCount() >= V.MAX_CAMS) { say(`Faces are full (${V.MAX_CAMS} max). Chat and draw still work.`); return; }
            const version = ++captureVersion[mediaKind];
            if (!app.av.asked[kind]) {
                const ok = await ask(kind === 'cam' ? 'Turn on your camera?' : 'Turn on your mic?',
                    kind === 'cam'
                        ? 'Tap Allow on the next pop-up. Only this room sees you.'
                        : app.av.jam
                            ? 'This is for talking between songs. Your playing goes through WebJam, so keep this off while you play or people hear you twice. Your browser will ask: tap Allow.'
                            : 'Tap Allow on the next pop-up. Only this room hears you.', { adult18: kind === 'cam' });
                if (!ok) return;
            }
            if (version !== captureVersion[mediaKind]) return;
            try {
                if (kind === 'cam') {
                    const got = await navigator.mediaDevices.getUserMedia({ video: camConstraints() });
                    if (!keepCapture('video', version, got, restore)) return;
                    stopRaw('video');
                    app.av.rawCam = got.getVideoTracks()[0];
                    app.av.canvas = false;
                    setTrack('video', app.av.rawCam);
                    if (app.av.bg.choice && app.av.bg.choice !== 'none') setBackground(app.av.bg.choice, true);
                } else {
                    const got = await navigator.mediaDevices.getUserMedia({ audio: V.micConstraints(app.av.music, prefs().mic) });
                    if (!keepCapture('audio', version, got)) return;
                    stopRaw('audio');
                    setTrack('audio', got.getAudioTracks()[0]);
                }
                app.av.asked[kind] = true;
                app.av[kind] = true;
                ensureAudioCtx();
            } catch (error) {
                if (version !== captureVersion[mediaKind]) return;
                if (kind === 'cam' && !app.av.mic && !app.av.jam) {
                    // No camera (blocked, missing or busy)? Don't strand them: offer voice only.
                    const voice = await ask('Camera’s not available', 'Join with just your voice? You can add the camera later.');
                    if (version !== captureVersion[mediaKind]) return;
                    if (voice) { app.av.asked.mic = true; await toggle('mic'); }
                    if (app.av.mic) { say('You’re in with voice only. To add video, allow Camera by the address bar, then tap the camera button.'); return; }
                }
                say(kind === 'cam'
                    ? 'Camera’s blocked. Tap the lock or “aA” icon by the address bar, allow Camera, then try again.'
                    : 'Mic’s blocked. Tap the lock or “aA” icon by the address bar, allow Microphone, then try again.');
                return;
            }
        } else {
            stopRaw(mediaKind);
            app.av[kind] = false;
        }
        await refreshAv();
    }

    /* "Show my real canvas": the back camera, sharper, shown as a rectangle. */
    async function toggleCanvasCam(restore) {
        if (app.av.canvas) {
            stopRaw('video');
            app.av.canvas = false;
            app.av.cam = false;
            await refreshAv();
            return;
        }
        if (app.av.kicked || (!restore && app.av.locked && !(app.av.mic || app.av.cam))) { say('Faces are locked by the host right now.'); return; }
        if (!restore && !(app.av.mic || app.av.cam) && avCount() >= V.MAX_CAMS) { say(`Faces are full (${V.MAX_CAMS} max). Chat and draw still work.`); return; }
        const version = ++captureVersion.video;
        const ok = restore || await ask('Show your real canvas?',
            'Point your camera at your easel, sketchbook or lump of clay. Your browser will ask to use the camera. Tap Allow. On phones we try the back camera. Only people in this room see it.', { adult18: true });
        if (!ok || version !== captureVersion.video) return;
        try {
            const got = await navigator.mediaDevices.getUserMedia({ video: CANVAS_CAM });
            if (!keepCapture('video', version, got, restore)) return;
            stopRaw('video');
            app.av.rawCam = got.getVideoTracks()[0];
            setTrack('video', app.av.rawCam);
            app.av.cam = true;
            app.av.canvas = true;
        } catch (error) {
            if (version !== captureVersion.video) return;
            say('Camera’s blocked. Tap the lock or “aA” icon by the address bar, allow Camera, then try again.');
            return;
        }
        await refreshAv();
    }

    /* Screen share replaces your camera while it's on (desktop browsers). */
    async function toggleScreen() {
        if (app.av.screen) { await stopScreen(); return; }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { say('Screen sharing needs a computer browser (Chrome, Edge, Firefox or Safari).'); return; }
        if (app.av.kicked || (app.av.locked && !(app.av.mic || app.av.cam))) { say('Faces are locked by the host right now.'); return; }
        if (!(app.av.mic || app.av.cam) && avCount() >= V.MAX_CAMS) { say(`Faces are full (${V.MAX_CAMS} max).`); return; }
        const version = ++captureVersion.video;
        let track;
        try {
            const got = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 8, max: 15 }, width: { max: 1920 }, height: { max: 1080 } }, audio: false });
            if (!keepCapture('video', version, got)) return;
            track = got.getVideoTracks()[0];
        } catch (error) { if (version === captureVersion.video) say('Screen share cancelled.'); return; }
        try { track.contentHint = 'detail'; } catch (error) { /* older browsers */ }
        track.addEventListener('ended', () => { if (app.av.screen === track) stopScreen(); });
        app.av.camWasOn = app.av.cam;
        app.av.canvasWasOn = app.av.canvas;
        stopRaw('video');
        app.av.screen = track;
        app.av.canvas = false;
        setTrack('video', track);
        app.av.cam = true;
        await refreshAv();
        say('You’re sharing your screen. Everyone sees it big.');
    }
    async function stopScreen(silent) {
        if (!app.av.screen) return;
        stopRaw('video');
        app.av.cam = false;
        app.av.canvas = false;
        if (app.av.camWasOn && !silent) {
            if (app.av.canvasWasOn) await toggleCanvasCam(true);
            else { app.av.asked.cam = true; await toggle('cam', true); }
            return;
        }
        await refreshAv();
    }

    async function refreshAv() {
        ui.canvasCam.setAttribute('aria-pressed', String(app.av.canvas));
        ui.canvasCam.textContent = app.av.canvas ? 'Stop showing my canvas' : 'Show my real canvas';
        ui.mic.setAttribute('aria-pressed', String(app.av.mic));
        ui.cam.setAttribute('aria-pressed', String(app.av.cam && !app.av.screen));
        ui.mic.textContent = app.av.mic ? 'Mute my mic' : (app.av.jam ? 'Talk (browser mic)' : 'Turn on my mic');
        ui.cam.textContent = app.av.cam && !app.av.screen ? 'Turn off my camera' : 'Turn on my camera';
        ui.cam.disabled = app.av.canvas;
        ui.share.setAttribute('aria-pressed', String(Boolean(app.av.screen)));
        ui.share.textContent = app.av.screen ? 'Stop sharing' : 'Share screen';
        ui.hand.setAttribute('aria-pressed', String(Number.isFinite(app.av.hand)));
        ui.hand.textContent = Number.isFinite(app.av.hand) ? 'Lower hand' : 'Raise hand';
        ui.hangup.hidden = !(app.av.mic || app.av.cam);
        paintControls();
        doc.body.classList.toggle('faces-on', Boolean(app.av.mic || app.av.cam || app.av.peers.size));
        if (app.av.mic || app.av.cam) wakeLock(true); else wakeLock(false);
        await send({ type: 'av', av: avFlags() });
        if (!(app.av.mic || app.av.cam)) Array.from(app.av.pcs.keys()).filter((id) => !app.av.peers.has(id)).forEach(closePc);
        for (const id of app.av.peers) if (!app.av.pcs.has(id)) openPc(id);
        for (const entry of app.av.pcs.values()) syncTracks(entry);
        for (const entry of app.av.pcs.values()) entry.pumpOffer();
        layout();
    }

    function paintControls() {
        // Phones show big icons with a one-word caption; the full words stay for screen readers and desktops.
        const ico = (el, i, short) => { el.dataset.ico = i; el.dataset.short = short; };
        ico(ui.mic, app.av.mic ? '🎤' : '🔇', app.av.mic ? 'Mute' : (app.av.jam ? 'Talk' : 'Mic'));
        ico(ui.cam, app.av.cam && !app.av.screen ? '📷' : '🚫', app.av.cam && !app.av.screen ? 'Cam off' : 'Camera');
        ico(ui.hand, '✋', Number.isFinite(app.av.hand) ? 'Lower' : 'Hand');
        ico(ui.settings, '⚙️', 'Setup');
        ico(ui.pip, '⧉', 'Pop out');
        ico(ui.view, '▦', ui.tiles.dataset.view === 'speaker' ? 'Grid' : 'Speaker');
        ico(ui.hangup, '✖', 'Leave');
        ico(ui.canvasCam, '🖼', app.av.canvas ? 'Stop art' : 'Art cam');
    }

    /* Swap tracks in place with replaceTrack so device changes, backgrounds and screen
     * share don't renegotiate. A sender is only added the first time a kind appears. */
    function syncTracks(entry) {
        const tracks = app.av.stream ? app.av.stream.getTracks() : [];
        for (const kind of ['audio', 'video']) {
            const t = tracks.find((x) => x.kind === kind) || null;
            const sender = entry.senders[kind];
            if (!sender && t) entry.senders[kind] = entry.pc.addTrack(t, app.av.stream);
            else if (sender && sender.track !== t) sender.replaceTrack(t).catch(() => {});
        }
        applyEncoding();
    }

    /* One uplink plan for all viewers (see HangoutVideo.planUplink), then apply it. */
    function applyEncoding() {
        const viewers = [];
        for (const [id, e] of app.av.pcs) if (e.senders.video && e.senders.video.track) viewers.push({ id, wantHi: e.wantHi, hiSince: e.hiSince, tier: e.tier, relayed: e.relayed });
        const audioBps = app.av.mic ? (app.av.music ? MUSIC_BPS : MIC_BPS) : 0;
        const plan = V.planUplink({ viewers, phone: PHONE, cams: camCount(), screen: Boolean(app.av.screen), jam: app.av.jam, audioBps });
        app.av.plan = plan;
        for (const [id, entry] of app.av.pcs) {
            for (const kind of ['audio', 'video']) {
                const sender = entry.senders[kind];
                if (!sender || !sender.track) continue;
                const p = sender.getParameters();
                if (!p.encodings || !p.encodings.length) p.encodings = [{}];
                if (kind === 'video') {
                    const enc = plan[id];
                    if (!enc) continue;
                    p.encodings[0].active = enc.active && !app.av.away;
                    if (enc.maxBitrate) p.encodings[0].maxBitrate = app.av.canvas ? Math.min(enc.maxBitrate, CAM_BPS) : enc.maxBitrate;
                    if (enc.maxFramerate) p.encodings[0].maxFramerate = enc.maxFramerate;
                    p.encodings[0].scaleResolutionDownBy = enc.scaleResolutionDownBy;
                    if (app.av.screen) p.degradationPreference = 'maintain-resolution';
                } else {
                    p.encodings[0].maxBitrate = app.av.music ? MUSIC_BPS : MIC_BPS;
                }
                sender.setParameters(p).catch(() => {});
            }
        }
    }

    async function openPc(id) {
        const peer = relayPeers.get(id);
        if (!peer?.live || app.av.pcs.has(id) || app.av.removed.has(id)) return;
        const pending = app.av.opening.get(id);
        if (pending?.peer === peer) return pending.ready;
        let finish;
        const ready = new Promise((resolve) => { finish = resolve; });
        const opening = { peer, ready };
        app.av.opening.set(id, opening);
        try {
            await iceServers();
            if (!peer.live || app.av.pcs.has(id) || app.av.removed.has(id) || !app.names.has(id) || !(app.av.mic || app.av.cam || app.av.peers.has(id))) return;
            const pc = new RTCPeerConnection({ iceServers: app.av.ice || STUN });
            const conn = navigator.connection || {};
            const thrifty = Boolean(conn.saveData) || conn.type === 'cellular' || /(^|-)2g|3g/.test(conn.effectiveType || '');
            const entry = { pc, polite: app.myId > id, makingOffer: false, offerNeeded: false, waitingInitialOffer: false, ignoreOffer: false, settingRemoteAnswer: false, remoteOfferPending: false, remoteOfferJobs: 0, pendingIce: [], relayed: false, stream: new MediaStream(), senders: {}, wantHi: false, tier: thrifty ? 'weak' : 'ok', hist: [], restarts: 0, last: null };
            app.av.pcs.set(id, entry);
            const current = () => peer.live && app.av.pcs.get(id) === entry;
            pc.onicecandidate = (e) => { if (current() && e.candidate) send({ type: 'rtc', to: id, ice: e.candidate.toJSON() }); };
            const initial = () => !pc.localDescription && !pc.remoteDescription;
            const waitForInitialOffer = () => initial() && entry.polite && (app.av.mic || app.av.cam) && app.av.peers.has(id);
            entry.pumpOffer = async () => {
                if (!current() || app.av.removed.has(id) || !(entry.offerNeeded || entry.waitingInitialOffer)
                    || entry.makingOffer || entry.remoteOfferPending || pc.signalingState !== 'stable') return;
                if (waitForInitialOffer()) {
                    entry.waitingInitialOffer = true;
                    entry.offerNeeded = false;
                    return;
                }
                const initialAttempt = initial();
                // This attempt owns existing native work. A later browser event
                // latches separate work even while createOffer/send is pending.
                entry.offerNeeded = false;
                entry.makingOffer = true;
                let failed = false;
                try {
                    const offer = await pc.createOffer();
                    if (!current()) return;
                    if (entry.remoteOfferPending || pc.signalingState !== 'stable') {
                        if (initialAttempt && !pc.remoteDescription) entry.waitingInitialOffer = true;
                        else if (!initialAttempt) entry.offerNeeded = true;
                        return;
                    }
                    if (waitForInitialOffer()) { entry.waitingInitialOffer = true; return; }
                    if (app.av.music) offer.sdp = V.musicSdp(offer.sdp);
                    await pc.setLocalDescription(offer);
                    if (!current()) return;
                    entry.waitingInitialOffer = false;
                    await send({ type: 'rtc', to: id, sdp: pc.localDescription.toJSON() });
                } catch (error) {
                    failed = true;
                    if (initialAttempt && !pc.remoteDescription) entry.waitingInitialOffer = true;
                    else entry.offerNeeded = true;
                    // Retain debt for a later native/AV/signaling event. Retrying
                    // this same exception from finally would create a busy loop.
                } finally {
                    entry.makingOffer = false;
                    if (!failed) entry.pumpOffer();
                }
            };
            pc.onnegotiationneeded = () => {
                if (!current()) return;
                entry.offerNeeded = true;
                entry.pumpOffer();
            };
            pc.ontrack = (e) => {
                if (!current()) return;
                entry.stream.addTrack(e.track);
                e.track.onended = () => {
                    entry.stream.removeTrack(e.track);
                    pruneStreamTracks(entry.stream);
                    layout();
                };
                pruneStreamTracks(entry.stream);
                if (e.track.kind === 'audio') watchLevel(id, entry.stream);
                layout();
            };
            pc.onconnectionstatechange = () => {
                if (!current()) return;
                const s = pc.connectionState;
                if (s === 'connected') { entry.restarts = 0; checkRelay(id, entry); layout(); }
                if (s === 'disconnected') win.setTimeout(() => { if (pc.connectionState === 'disconnected') restartIce(id, entry); }, 3000);
                if (s === 'failed') restartIce(id, entry);
            };
            syncTracks(entry);
            if (!Object.keys(entry.senders).length) {
                pc.addTransceiver('audio', { direction: 'recvonly' });
                pc.addTransceiver('video', { direction: 'recvonly' });
            }
            layout();
        } catch (_) { say('Couldn’t start this video connection. Chat and drawing remain available.'); }
        finally {
            if (app.av.opening.get(id) === opening) app.av.opening.delete(id);
            finish();
        }
    }

    /* Reconnect: ICE restart a few times, then give up on that one face politely. */
    function restartIce(id, entry) {
        if (app.av.pcs.get(id) !== entry) return;
        entry.restarts += 1;
        if (entry.restarts > 3) {
            say(`Couldn’t connect faces with ${peerName(id)}. Chat and draw still work.`);
            closePc(id);
            return;
        }
        say(`Reconnecting to ${peerName(id)}…`);
        try { entry.pc.restartIce(); } catch (error) { /* old browser */ }
    }

    async function checkRelay(id, entry) {
        try {
            const stats = await entry.pc.getStats();
            let pair = null;
            stats.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId); });
            if (!pair) stats.forEach((r) => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
            const local = pair && stats.get(pair.localCandidateId);
            const remote = pair && stats.get(pair.remoteCandidateId);
            entry.relayed = Boolean((local && local.candidateType === 'relay') || (remote && remote.candidateType === 'relay'));
            if (entry.relayed) app.av.relayed.add(id); else app.av.relayed.delete(id);
            applyEncoding();
        } catch (error) { /* stats unavailable */ }
    }

    /* Connection quality: every 2 s read getStats, grade the link, adapt, show bars. */
    async function sampleQuality() {
        for (const [id, entry] of app.av.pcs) {
            if (entry.pc.connectionState !== 'connected') continue;
            try {
                const stats = await entry.pc.getStats();
                let rtt; let outKbps; let lost = 0; let got = 0;
                stats.forEach((r) => {
                    if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') {
                        if (Number.isFinite(r.currentRoundTripTime)) rtt = r.currentRoundTripTime;
                        if (Number.isFinite(r.availableOutgoingBitrate)) outKbps = r.availableOutgoingBitrate / 1000;
                    }
                    if (r.type === 'inbound-rtp') { lost += r.packetsLost || 0; got += r.packetsReceived || 0; }
                });
                const prev = entry.last || { lost, got };
                const dl = lost - prev.lost; const dg = got - prev.got;
                entry.last = { lost, got };
                const loss = dl + dg > 20 ? Math.max(0, dl) / (dl + dg) : undefined;
                entry.hist = entry.hist.concat(V.gradeLink({ rtt, loss, outKbps })).slice(-5);
                const tier = V.nextTier(entry.hist, entry.tier);
                if (tier !== entry.tier) {
                    if (tier === 'bad') say(`Weak link with ${peerName(id)}: video paused, audio kept.`);
                    if (entry.tier === 'bad') say(`Link with ${peerName(id)} recovered. Video’s back.`);
                    entry.tier = tier;
                    applyEncoding();
                }
                entry.stats = { rtt, loss, outKbps };
            } catch (error) { /* closed mid-read */ }
        }
        layout();
    }
    win.setInterval(sampleQuality, 2000);

    async function onRtc(from, msg, peer) {
        if (!peer.live || app.av.removed.has(from)) return;
        if (!(app.av.mic || app.av.cam) && !app.av.peers.has(from)) return;
        if (!app.av.pcs.has(from)) await openPc(from);
        const entry = app.av.pcs.get(from);
        if (!entry || !peer.live) return;
        const pc = entry.pc;
        const current = () => peer.live && app.av.pcs.get(from) === entry;
        try {
            if (msg.sdp) {
                const readyForOffer = !entry.makingOffer && (pc.signalingState === 'stable' || entry.settingRemoteAnswer);
                const collision = msg.sdp.type === 'offer' && !readyForOffer;
                entry.ignoreOffer = !entry.polite && collision;
                if (entry.ignoreOffer) return;
                const answer = msg.sdp.type === 'answer';
                const offer = msg.sdp.type === 'offer';
                if (answer) entry.settingRemoteAnswer = true;
                // An older offer callback must not clear a newer callback's
                // guard while its native answer/encrypted publication is pending.
                if (offer) { entry.remoteOfferJobs += 1; entry.remoteOfferPending = true; }
                try {
                    try { await pc.setRemoteDescription(msg.sdp); }
                    finally { if (answer) entry.settingRemoteAnswer = false; }
                    if (!current()) return;
                    if (offer) entry.waitingInitialOffer = false;
                    for (const ice of entry.pendingIce.splice(0)) {
                        try { await pc.addIceCandidate(ice); } catch (_) { /* stale candidate from a prior negotiation */ }
                        if (!current()) return;
                    }
                    if (offer) {
                        const answer = await pc.createAnswer();
                        if (!current()) return;
                        if (app.av.music) answer.sdp = V.musicSdp(answer.sdp);
                        await pc.setLocalDescription(answer);
                        if (!current()) return;
                        await send({ type: 'rtc', to: from, sdp: pc.localDescription.toJSON() });
                    }
                } finally {
                    if (offer) {
                        entry.remoteOfferJobs -= 1;
                        entry.remoteOfferPending = entry.remoteOfferJobs > 0;
                    }
                    if (current()) entry.pumpOffer();
                }
            } else if (msg.ice) {
                if (!pc.remoteDescription) {
                    if (entry.pendingIce.length < 64) entry.pendingIce.push(msg.ice);
                    return;
                }
                try { await pc.addIceCandidate(msg.ice); } catch (error) { if (!entry.ignoreOffer) throw error; }
            }
        } catch (error) { /* bad signaling from a peer; ignore */ }
    }

    function closePc(id) {
        const entry = app.av.pcs.get(id);
        if (entry) { entry.offerNeeded = false; entry.waitingInitialOffer = false; entry.pc.close(); app.av.pcs.delete(id); }
        app.av.relayed.delete(id);
        delete app.av.levels[id];
        const meter = app.av.meters.get(id);
        if (meter) { try { meter.src.disconnect(); } catch (error) { /* gone */ } app.av.meters.delete(id); }
        const tile = ui.tiles.querySelector(`[data-tile="${CSS.escape(id)}"]`);
        if (tile) tile.remove();
        layout();
    }

    function stopAv(closeAll = false) {
        stopRaw('video');
        stopRaw('audio');
        app.av.stream = null;
        app.av.mic = false;
        app.av.cam = false;
        app.av.canvas = false;
        app.av.hand = null;
        if (closeAll) Array.from(app.av.pcs.keys()).forEach(closePc);
        const me = ui.tiles.querySelector('[data-tile="me"]');
        if (me) me.remove();
        wakeLock(false);
    }

    /* ---------------- active speaker (Web Audio level meters) ---------------- */
    function ensureAudioCtx() {
        if (!app.av.ac && win.AudioContext) {
            try { app.av.ac = new win.AudioContext(); } catch (error) { app.av.ac = null; }
        }
        if (app.av.ac) {
            watchLevel('me', app.av.mic ? app.av.stream : null);
            // Remote audio can arrive before a local camera or mic gesture creates the context.
            for (const [id, entry] of app.av.pcs) watchLevel(id, entry.stream);
        }
        return app.av.ac;
    }
    function watchLevel(id, stream) {
        const ac = app.av.ac;
        const track = stream && stream.getAudioTracks().find((t) => t.readyState === 'live');
        const old = app.av.meters.get(id);
        if (old && old.track === track) return;
        if (old) { try { old.src.disconnect(); } catch (error) { /* gone */ } }
        app.av.meters.delete(id);
        delete app.av.levels[id];
        if (!ac || !track) return;
        try {
            const src = ac.createMediaStreamSource(new MediaStream([track]));
            const an = ac.createAnalyser();
            an.fftSize = 512;
            src.connect(an);
            app.av.meters.set(id, { track, src, an, buf: new Float32Array(an.fftSize) });
        } catch (error) { /* no audio graph */ }
    }
    win.setInterval(() => {
        // A muted mic is stopped; turning it back on must meter the replacement track.
        watchLevel('me', app.av.mic ? app.av.stream : null);
        for (const [id, m] of app.av.meters) {
            m.an.getFloatTimeDomainData(m.buf);
            let sum = 0;
            for (let i = 0; i < m.buf.length; i += 1) sum += m.buf[i] * m.buf[i];
            const muted = id === 'me' ? !app.av.mic : !app.av.micPeers.has(id);
            app.av.levels[id] = muted ? 0 : Math.sqrt(sum / m.buf.length);
        }
        const next = V.pickSpeaker(app.av.levels, app.av.speaker.id, Date.now(), app.av.speaker.since);
        const changed = next.id !== app.av.speaker.id;
        app.av.speaker = next;
        ui.tiles.querySelectorAll('.tile').forEach((t) => t.classList.toggle('is-talking', (app.av.levels[t.dataset.tile] || 0) > 0.04));
        if (changed) layout();
    }, 250);

    /* ---------------- layout: grid or speaker view ---------------- */
    function presentIds() {
        const ids = [];
        for (const id of app.av.peers) if (!app.av.hidden.has(id)) ids.push(id);
        if (app.av.cam || app.av.mic) ids.push('me'); // you go last, like every call app
        return ids;
    }
    function layout() {
        const ids = presentIds();
        const screenId = app.av.screen ? 'me' : Array.from(app.av.screenPeers).find((id) => app.av.peers.has(id)) || null;
        const auto = app.av.view === 'speaker' || Boolean(screenId) || Boolean(app.av.spot) || Boolean(app.av.pin);
        const main = auto ? V.mainTile({ present: ids, spotlight: app.av.spot === app.myId ? 'me' : app.av.spot, pin: app.av.pin, screen: screenId, speaker: app.av.speaker.id || ids.find((x) => x !== 'me') }) : null;
        ui.tiles.dataset.view = main ? 'speaker' : 'grid';
        ui.tiles.style.setProperty('--cols', String(V.gridColumns(ids.length, win.innerWidth > 820)));
        for (const id of ids) renderTile(id, main === id);
        ui.tiles.querySelectorAll('.tile').forEach((t) => { if (!ids.includes(t.dataset.tile)) t.remove(); });
        const order = [main].concat(ids.filter((id) => id !== main)).filter(Boolean);
        const now = Array.from(ui.tiles.children).map((t) => t.dataset.tile);
        if (now.join() !== order.join()) order.forEach((id) => { const t = ui.tiles.querySelector(`[data-tile="${CSS.escape(id)}"]`); if (t) ui.tiles.append(t); });
        ui.view.textContent = ui.tiles.dataset.view === 'speaker' ? 'Grid view' : 'Speaker view';
        ui.view.hidden = ids.length < 2;
        paintControls();
        // Tell each sender whether we're watching them big, so they send us the sharp feed.
        for (const id of app.av.pcs.keys()) {
            const hi = main === id;
            if (app.av.wantSent.get(id) !== hi) { app.av.wantSent.set(id, hi); send({ type: 'want', to: id, hi }); }
        }
        renderHands();
    }

    function bars(tier) {
        const n = { good: 4, ok: 3, weak: 2, bad: 1 }[tier] || 0;
        return `${'▮'.repeat(n)}${'▯'.repeat(4 - n)}`;
    }

    function renderTile(id, big) {
        let tile = ui.tiles.querySelector(`[data-tile="${CSS.escape(id)}"]`);
        const entry = app.av.pcs.get(id);
        const stream = id === 'me' ? app.av.stream : entry && entry.stream;
        if (!tile) {
            tile = doc.createElement('figure');
            tile.className = 'tile';
            tile.dataset.tile = id;
            const v = doc.createElement('video');
            v.autoplay = true;
            v.playsInline = true;
            v.muted = id === 'me';
            const cap = doc.createElement('figcaption');
            const nm = doc.createElement('span');
            nm.className = 'nm';
            const q = doc.createElement('b');
            q.className = 'q';
            q.setAttribute('role', 'img');
            cap.append(nm, q);
            const badge = doc.createElement('i');
            badge.className = 'badge';
            const more = doc.createElement('button');
            more.type = 'button';
            more.className = 'more';
            more.textContent = '⋯';
            more.setAttribute('aria-label', `Options for ${peerName(id)}`);
            more.addEventListener('click', (e) => { e.stopPropagation(); tileMenu(id, more); });
            // Small tiles are too tight for the ⋯ button on phones: tapping the tile opens the same menu.
            tile.addEventListener('click', () => { if (!tile.classList.contains('tile--big') && ui.tiles.dataset.view === 'speaker') tileMenu(id, more); });
            const react = doc.createElement('em');
            react.className = 'react';
            react.setAttribute('aria-live', 'polite');
            tile.append(v, cap, badge, more, react);
            ui.tiles.append(tile);
            if (id !== 'me' && app.av.sink && v.setSinkId) v.setSinkId(app.av.sink).catch(() => {});
        }
        const v = tile.querySelector('video');
        if (v.srcObject !== (stream || null)) v.srcObject = stream || null;
        if (id !== 'me' && v.paused && stream) v.play().catch(() => {});
        const isCanvas = id === 'me' ? app.av.canvas : app.av.canvasPeers.has(id);
        const isScreen = id === 'me' ? Boolean(app.av.screen) : app.av.screenPeers.has(id);
        const camOn = id === 'me' ? app.av.cam : app.av.camPeers.has(id);
        const paused = entry && entry.tier === 'bad';
        tile.classList.toggle('tile--canvas', isCanvas);
        tile.classList.toggle('tile--screen', isScreen);
        tile.classList.toggle('tile--big', big);
        tile.classList.toggle('tile--nocam', !camOn || paused || (id !== 'me' && app.av.awayPeers.has(id)));
        tile.classList.toggle('tile--mirror', id === 'me' && camOn && !isScreen && !isCanvas);
        tile.dataset.initial = (peerName(id).trim()[0] || '?').toUpperCase();
        const label = id === 'me'
            ? (app.av.canvas ? `${app.name}’s canvas (you)` : `${app.name} (you)`)
            : `${isCanvas ? `${peerName(id)}’s canvas` : peerName(id)}${isScreen ? ' · screen' : ''}`;
        tile.querySelector('.nm').textContent = label;
        const micOn = id === 'me' ? app.av.mic : app.av.micPeers.has(id);
        const handUp = id === 'me' ? Number.isFinite(app.av.hand) : Number.isFinite(app.av.hands[id]);
        tile.querySelector('.badge').textContent = `${handUp ? '✋' : ''}${micOn ? '' : '🔇'}${app.av.pin === id ? '📌' : ''}${paused ? ' audio only' : ''}`;
        const q = tile.querySelector('.q');
        if (entry) {
            q.textContent = bars(entry.tier);
            q.dataset.tier = entry.tier;
            q.setAttribute('aria-label', `${V.qualityLabel(entry.tier)}${entry.stats && Number.isFinite(entry.stats.rtt) ? `, ${Math.round(entry.stats.rtt * 1000)} ms` : ''}`);
            q.title = q.getAttribute('aria-label');
        } else { q.textContent = ''; q.removeAttribute('aria-label'); }
    }

    function renderHands() {
        const q = V.handQueue(Object.assign({}, app.av.hands, Number.isFinite(app.av.hand) ? { me: app.av.hand } : {}));
        ui.hands.hidden = !q.length;
        ui.hands.textContent = q.length ? `✋ ${q.map((id) => peerName(id)).join(', ')}` : '';
    }

    /* Per-tile menu: pin / hide for me / report, plus host moderation. */
    function tileMenu(id, anchor) {
        const m = ui.tileMenu;
        m.textContent = '';
        const item = (text, fn, cls) => {
            const b = doc.createElement('button');
            b.type = 'button';
            b.textContent = text;
            if (cls) b.className = cls;
            b.addEventListener('click', () => { m.close(); fn(); });
            m.append(b);
        };
        const h = doc.createElement('h3');
        h.textContent = peerName(id);
        m.append(h);
        item(app.av.pin === id ? 'Unpin' : 'Pin big for me', () => { app.av.pin = app.av.pin === id ? null : id; layout(); });
        const tile = ui.tiles.querySelector(`[data-tile="${CSS.escape(id)}"] video`);
        if (tile && (doc.pictureInPictureEnabled || tile.webkitSupportsPresentationMode)) item('Pop out (picture-in-picture)', () => popOut(tile));
        if (id !== 'me') {
            item('Hide for me', () => { app.av.hidden.add(id); layout(); say(`Hid ${peerName(id)} for you. Reload to bring them back.`); });
            item('Report to the host', () => reportPeer(id), 'warn');
            const notice = doc.createElement('p'); notice.className = 'small';
            notice.textContent = 'Host notices are best effort and are not saved for community staff.';
            m.append(notice);
            if (app.privateReports) item('Report to community staff', () => openStaffReport({ peer: id, name: peerName(id) }, anchor), 'warn');
            if (app.isHost) {
                const hs = doc.createElement('h3');
                hs.textContent = 'Host';
                m.append(hs);
                item('Mute them', () => hostAct({ kind: 'mute', target: id }));
                item('Turn their camera off', () => hostAct({ kind: 'camoff', target: id }));
                item(app.av.spot === id ? 'End spotlight' : 'Spotlight for everyone', () => hostAct({ kind: 'spot', target: app.av.spot === id ? null : id }));
                item('Take them off faces', () => hostAct({ kind: 'remove', target: id }), 'warn');
            }
        } else if (app.isHost) {
            item(app.av.spot === app.myId ? 'End spotlight' : 'Spotlight me for everyone', () => hostAct({ kind: 'spot', target: app.av.spot === app.myId ? null : app.myId }));
        }
        item('Close', () => {});
        if (m.showModal) m.showModal();
        if (anchor && anchor.focus) m.addEventListener('close', () => anchor.focus(), { once: true });
    }

    async function popOut(video) {
        try {
            if (doc.pictureInPictureElement === video) await doc.exitPictureInPicture();
            else if (video.requestPictureInPicture) await video.requestPictureInPicture();
            else if (video.webkitSetPresentationMode) video.webkitSetPresentationMode('picture-in-picture');
        } catch (error) { say('Your browser won’t pop this out.'); }
    }

    async function reportPeer(id) {
        app.av.hidden.add(id);
        layout();
        if (!app.connected || app.ws?.readyState !== 1) {
            say(`Hid ${peerName(id)} for you. You are offline, so no host notice was sent.`);
            return;
        }
        try { await send({ type: 'report', about: id, name: peerName(id) }); } catch (_) { /* no delivery acknowledgement exists */ }
        if (!app.ended) say(`Hid ${peerName(id)} for you. Tried to notify the host; delivery is not confirmed.`);
    }

    /* ---------------- host moderation (signed by the room creator) ---------------- */
    async function hostAct(action) {
        if (!app.isHost || !app.connected) return;
        return hostWork(async () => {
            app.lastHostSeq = Math.max(app.lastHostSeq + 1, Date.now());
            const body = V.cleanHostAction(Object.assign({}, action, { seq: app.lastHostSeq }));
            if (!body) return;
            const signed = await signHost(body);
            if (app.ended) return;
            applyHostAction(body, signed, true);
            recordHost(signed, app.clock.relayNow());
            await send(signed);
        });
    }
    function applyHostAction(body, signed, mine) {
        const a = V.cleanHostAction(body);
        if (!a) return;
        const me = app.myId;
        if (a.kind === 'lock') {
            app.av.locked = a.on;
            app.av.mods.lock = signed;
            ui.lock.setAttribute('aria-pressed', String(a.on));
            ui.lock.textContent = a.on ? 'Unlock faces' : 'Lock faces';
            if (!mine) say(a.on ? 'The host locked faces: nobody new can join the call for now.' : 'The host unlocked faces.');
        } else if (a.kind === 'spot') {
            app.av.spot = a.target;
            app.av.mods.spot = signed;
            if (!mine && a.target) say(`The host put ${a.target === me ? 'you' : peerName(a.target)} in the spotlight.`);
        } else if (a.kind === 'mute') {
            if (a.target === me) { stopRaw('audio'); app.av.mic = false; refreshAv(); say('The host muted you. You can unmute when you’re ready.'); }
        } else if (a.kind === 'camoff') {
            if (a.target === me || a.target === '*') {
                stopRaw('video'); app.av.cam = false; app.av.canvas = false; refreshAv();
                say('The host turned your camera off.');
            }
        } else if (a.kind === 'remove') {
            if (a.target === me) { app.av.kicked = true; stopAv(true); refreshAv(); say('The host took you off faces in this room. Chat and draw still work.'); }
            else { app.av.removed.add(a.target); noteAv(a.target, null); closePc(a.target); }
        }
        layout();
    }

    /* ---------------- hands, reactions ---------------- */
    async function toggleHand() {
        app.av.hand = Number.isFinite(app.av.hand) ? null : app.clock.relayNow();
        await refreshAv();
    }
    async function react(r) {
        const ok = V.cleanReaction(r);
        if (!ok) return;
        const lim = V.rateLimit(app.av.reactTimes, Date.now(), 5, 5000);
        app.av.reactTimes = lim.times;
        if (!lim.ok) { say('Easy on the emoji.'); return; }
        showReaction('me', ok);
        await send({ type: 'react', r: ok });
    }
    function showReaction(id, r) {
        const target = ui.tiles.querySelector(`[data-tile="${CSS.escape(id)}"] .react`) || ui.reactFloat;
        const s = doc.createElement('span');
        s.textContent = id === 'me' || target !== ui.reactFloat ? r : `${peerName(id)} ${r}`;
        target.append(s);
        win.setTimeout(() => s.remove(), 2600);
    }

    /* ---------------- devices, music mode, backgrounds ---------------- */
    async function fillDevices() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
        const list = await navigator.mediaDevices.enumerateDevices();
        const p = prefs();
        const fill = (sel, kind, current) => {
            sel.textContent = '';
            list.filter((d) => d.kind === kind).forEach((d, i) => {
                const o = doc.createElement('option');
                o.value = d.deviceId;
                o.textContent = d.label || `${kind === 'videoinput' ? 'Camera' : kind === 'audioinput' ? 'Mic' : 'Speaker'} ${i + 1}`;
                if (d.deviceId === current) o.selected = true;
                sel.append(o);
            });
            sel.closest('label').hidden = !sel.options.length;
        };
        fill(ui.devCam, 'videoinput', p.cam);
        fill(ui.devMic, 'audioinput', p.mic);
        fill(ui.devSpk, 'audiooutput', p.spk);
        if (!('setSinkId' in HTMLMediaElement.prototype)) ui.devSpk.closest('label').hidden = true;
    }
    async function switchDevice(kind, deviceId) {
        if (kind === 'spk') {
            savePrefs({ spk: deviceId });
            app.av.sink = deviceId;
            ui.tiles.querySelectorAll('.tile:not([data-tile="me"]) video').forEach((v) => { if (v.setSinkId) v.setSinkId(deviceId).catch(() => {}); });
            return;
        }
        savePrefs({ [kind]: deviceId });
        let pendingCamera = null;
        try {
            if (kind === 'cam' && app.av.cam && !app.av.screen && !app.av.canvas) {
                const version = ++captureVersion.video;
                const got = await navigator.mediaDevices.getUserMedia({ video: Object.assign({}, CAM, { deviceId: { exact: deviceId } }) });
                pendingCamera = got;
                if (!keepCapture('video', version, got)) return;
                const old = app.av.rawCam;
                if (app.av.bg.proc) await app.av.bg.proc.restart({ kind: 'video', track: got.getVideoTracks()[0], element: app.av.bg.el });
                if (!keepCapture('video', version, got)) return;
                app.av.rawCam = got.getVideoTracks()[0];
                setTrack('video', app.av.bg.proc ? app.av.bg.proc.processedTrack : app.av.rawCam);
                pendingCamera = null;
                if (old) old.stop();
            }
            if (kind === 'mic' && app.av.mic) await restartMic();
            for (const entry of app.av.pcs.values()) syncTracks(entry);
            layout();
        } catch (error) {
            if (pendingCamera) pendingCamera.getTracks().forEach((track) => track.stop());
            say('Couldn’t switch to that device. Is another app using it?');
        }
    }
    async function restartMic() {
        const version = ++captureVersion.audio;
        const got = await navigator.mediaDevices.getUserMedia({ audio: V.micConstraints(app.av.music, prefs().mic) });
        if (!keepCapture('audio', version, got)) return;
        stopRaw('audio');
        setTrack('audio', got.getAudioTracks()[0]);
        for (const entry of app.av.pcs.values()) syncTracks(entry);
        if (app.av.ac) watchLevel('me', app.av.stream);
    }
    async function setMusic(on) {
        app.av.music = Boolean(on);
        ui.music.checked = app.av.music;
        if (app.av.mic) await restartMic();
        // Stereo/128 kbps lives in the SDP, so renegotiate each link.
        for (const entry of app.av.pcs.values()) { try { entry.pc.restartIce(); } catch (error) { /* old browser */ } }
        applyEncoding();
        say(app.av.music ? 'Music mode on: no echo cancelling or noise gate. Wear headphones. (Not in time: use WebJam to play together.)' : 'Music mode off.');
    }

    function deviceStrength() {
        let webgl2 = false;
        try { webgl2 = Boolean(doc.createElement('canvas').getContext('webgl2')); } catch (error) { webgl2 = false; }
        let wasm = false;
        try { wasm = typeof WebAssembly === 'object' && WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch (error) { wasm = false; }
        return V.backgroundSupport({ wasm, webgl2, memory: navigator.deviceMemory, cores: navigator.hardwareConcurrency });
    }
    const BG_FILES = { checkerboard: 'fx/bg/checkerboard.png', stripes: 'fx/bg/stripes.png', stage: 'fx/bg/stage.png', blue: 'fx/bg/blue.png' };
    async function setBackground(choice, silent) {
        const bg = app.av.bg;
        bg.choice = choice;
        savePrefs({ bg: choice });
        ui.bgPicks.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.bg === choice)));
        if (choice === 'none') {
            if (bg.proc) { const p = bg.proc; bg.proc = null; await p.destroy().catch(() => {}); }
            if (app.av.rawCam && !app.av.screen) setTrack('video', app.av.rawCam);
            for (const entry of app.av.pcs.values()) syncTracks(entry);
            layout();
            return;
        }
        if (!app.av.rawCam || app.av.screen || app.av.canvas) { if (!silent) say('Background saved. It kicks in when your camera’s on.'); return; }
        const strength = deviceStrength();
        if (strength === 'no') { bg.choice = 'none'; say('This device can’t do backgrounds. Your camera still works fine.'); return; }
        if (strength === 'slow' && !silent) say('Backgrounds may be slow on this device. We’ll switch it off if it struggles.');
        try {
            bg.loading = true;
            ui.bgStatus.textContent = 'Loading background magic (one-time, about 3 MB)…';
            const mod = await import(new URL('fx/track-processors.mjs', win.location.href).href);
            if (!mod.supportsBackgroundProcessors()) throw new Error('unsupported');
            const opts = {
                mode: choice === 'blur' ? 'background-blur' : 'virtual-background',
                blurRadius: strength === 'slow' ? 6 : 12,
                imagePath: BG_FILES[choice] ? new URL(BG_FILES[choice], win.location.href).href : undefined,
                assetPaths: { tasksVisionFileSet: new URL('fx/wasm', win.location.href).href, modelAssetPath: new URL('fx/selfie_segmenter.tflite', win.location.href).href },
                onFrameProcessed: (s) => watchBackground(s && s.processingTimeMs)
            };
            if (choice === 'blur') delete opts.imagePath;
            bg.frames = [];
            if (bg.proc) await bg.proc.switchTo(opts);
            else {
                const proc = mod.BackgroundProcessor(opts);
                bg.el = bg.el || doc.createElement('video');
                bg.el.muted = true; bg.el.playsInline = true;
                await proc.init({ kind: 'video', track: app.av.rawCam, element: bg.el });
                if (bg.choice !== choice || !app.av.rawCam) { await proc.destroy(); return; }
                bg.proc = proc;
            }
            setTrack('video', bg.proc.processedTrack);
            for (const entry of app.av.pcs.values()) syncTracks(entry);
            layout();
            ui.bgStatus.textContent = '';
        } catch (error) {
            bg.error = String(error && error.message || error).slice(0, 200);
            bg.choice = 'none';
            ui.bgStatus.textContent = '';
            if (bg.proc) { const p = bg.proc; bg.proc = null; p.destroy().catch(() => {}); }
            if (app.av.rawCam) setTrack('video', app.av.rawCam);
            for (const entry of app.av.pcs.values()) syncTracks(entry);
            say('Backgrounds didn’t load on this device. Your normal camera is still on.');
        } finally { bg.loading = false; }
    }
    function watchBackground(ms) {
        const bg = app.av.bg;
        if (!Number.isFinite(ms)) return;
        bg.frames.push(ms);
        if (bg.frames.length > 40) bg.frames.shift();
        const verdict = V.backgroundVerdict(bg.frames);
        if (verdict === 'stop') { bg.frames = []; setBackground('none'); say('Background switched off: this device was struggling and it was making your video choppy.'); }
        else if (verdict === 'lighten' && !bg.light && app.av.rawCam) {
            bg.light = true; bg.frames = [];
            app.av.rawCam.applyConstraints({ width: { ideal: 480 }, height: { ideal: 270 }, frameRate: { ideal: 15 } }).catch(() => {});
        }
    }

    /* ---------------- phones: keep awake, pause camera when hidden ---------------- */
    async function wakeLock(on) {
        try {
            if (on && !app.av.lock && navigator.wakeLock && doc.visibilityState === 'visible') {
                app.av.lock = await navigator.wakeLock.request('screen');
                app.av.lock.addEventListener('release', () => { app.av.lock = null; });
            } else if (!on && app.av.lock) { await app.av.lock.release(); app.av.lock = null; }
        } catch (error) { /* not allowed now */ }
    }
    doc.addEventListener('visibilitychange', () => {
        const hidden = doc.visibilityState === 'hidden';
        const inPip = Boolean(doc.pictureInPictureElement);
        // Phones: keep your voice going in the background, rest the camera to save battery.
        if (PHONE && app.av.cam && !app.av.screen && !inPip) {
            app.av.away = hidden;
            applyEncoding();
            send({ type: 'av', av: avFlags() });
        }
        if (!hidden && (app.av.mic || app.av.cam)) wakeLock(true);
    });

    /* ---------------- pre-join check ---------------- */
    let activeCheck = null;
    function stopPreCheck() {
        const check = activeCheck;
        activeCheck = null;
        if (check) {
            if (check.stream) check.stream.getTracks().forEach((t) => t.stop());
            if (check.pc) check.pc.close();
            if (check.networkDone) check.networkDone(false);
            win.clearTimeout(check.timer);
            win.cancelAnimationFrame(check.frame);
            if (check.ac) check.ac.close().catch(() => {});
        }
        ui.checkVideo.srcObject = null;
        ui.checkMeter.value = 0;
        ui.check.hidden = true;
    }
    async function preCheck() {
        if (!app.av.adult18 && !await ask('Test your camera and mic?', 'This preview stays on your device and is stopped when you close it. Tap Allow on the next pop-up.', { adult18: true })) return;
        stopPreCheck();
        const check = { stream: null, ac: null, pc: null, timer: 0, frame: 0, networkDone: null };
        activeCheck = check;
        ui.check.hidden = false;
        ui.checkOut.textContent = 'Checking…';
        const lines = [];
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: camConstraints(), audio: V.micConstraints(false, prefs().mic) });
            // A permission prompt can outlive closing the preview or entering the room.
            if (activeCheck !== check) { stream.getTracks().forEach((t) => t.stop()); return; }
            check.stream = stream;
            ui.checkVideo.srcObject = stream;
            lines.push('✅ Camera works.');
            const ac = new (win.AudioContext || win.webkitAudioContext)();
            check.ac = ac;
            const an = ac.createAnalyser();
            ac.createMediaStreamSource(stream).connect(an);
            const buf = new Float32Array(an.fftSize);
            const tick = () => {
                if (activeCheck !== check) return;
                an.getFloatTimeDomainData(buf);
                let peak = 0;
                buf.forEach((x) => { peak = Math.max(peak, Math.abs(x)); });
                ui.checkMeter.value = Math.min(1, peak * 3);
                check.frame = win.requestAnimationFrame(tick);
            };
            tick();
            lines.push('🎤 Say something: the bar should jump.');
        } catch (error) {
            if (activeCheck !== check) return;
            lines.push('⚠️ Camera or mic is blocked. Allow them by the address bar if you want faces. Chat and draw work either way.');
        }
        ui.checkOut.textContent = lines.join(' ');
        try {
            const t0 = performance.now();
            const pc = new RTCPeerConnection({ iceServers: STUN });
            check.pc = pc;
            pc.createDataChannel('x');
            const found = new Promise((resolve) => {
                check.networkDone = resolve;
                pc.onicecandidate = (e) => { if (e.candidate && / srflx /.test(e.candidate.candidate)) resolve(true); if (!e.candidate) resolve(false); };
                check.timer = win.setTimeout(() => resolve(false), 4000);
            });
            await pc.setLocalDescription(await pc.createOffer());
            const ok = await found;
            const ms = Math.round(performance.now() - t0);
            lines.push(ok ? `🌐 Network looks good for direct video (${ms} ms).` : '🌐 Your network may block direct video (work or school Wi-Fi often does). Chat, draw and watch still work.');
        } catch (error) { lines.push('🌐 Couldn’t test the network.'); }
        finally {
            if (check.pc) check.pc.close();
            check.pc = null;
            check.networkDone = null;
            win.clearTimeout(check.timer);
        }
        if (activeCheck !== check) return;
        if (app.av.jam) lines.push('🎸 Jamming? Plug in an Ethernet cable and use WebJam for the music. Wired beats Wi-Fi by a mile.');
        else lines.push('Tip: headphones stop echo. A wired (Ethernet) connection beats Wi-Fi.');
        ui.checkOut.textContent = lines.join(' ');
    }

    ui.canvasCam.addEventListener('click', () => toggleCanvasCam());
    ui.mic.addEventListener('click', () => toggle('mic'));
    ui.cam.addEventListener('click', () => toggle('cam'));
    ui.share.addEventListener('click', () => toggleScreen());
    ui.pip.hidden = !(doc.pictureInPictureEnabled || 'webkitSetPresentationMode' in HTMLVideoElement.prototype);
    ui.pip.addEventListener('click', () => {
        const big = ui.tiles.querySelector('.tile--big video') || ui.tiles.querySelector('.tile:not([data-tile="me"]) video');
        if (big) popOut(big); else say('Nobody else is on camera yet.');
    });
    ui.hand.addEventListener('click', () => toggleHand());
    ui.view.addEventListener('click', () => { app.av.view = ui.tiles.dataset.view === 'speaker' ? 'grid' : 'speaker'; if (app.av.view === 'grid') app.av.pin = null; layout(); });
    ui.reacts.addEventListener('click', (e) => { const b = e.target.closest('button[data-r]'); if (b) react(b.dataset.r); });
    ui.settings.addEventListener('click', async () => { await fillDevices(); ui.settingsDlg.showModal(); });
    ui.settingsDlg.querySelector('[data-settings-close]').addEventListener('click', () => ui.settingsDlg.close());
    ui.devCam.addEventListener('change', () => switchDevice('cam', ui.devCam.value));
    ui.devMic.addEventListener('change', () => switchDevice('mic', ui.devMic.value));
    ui.devSpk.addEventListener('change', () => switchDevice('spk', ui.devSpk.value));
    ui.music.addEventListener('change', () => setMusic(ui.music.checked));
    ui.bgPicks.addEventListener('click', (e) => { const b = e.target.closest('button[data-bg]'); if (b && !app.av.bg.loading) setBackground(b.dataset.bg); });
    ui.lock.addEventListener('click', () => hostAct({ kind: 'lock', on: !app.av.locked }));
    ui.allCamsOff.addEventListener('click', () => hostAct({ kind: 'camoff', target: '*' }));
    ui.checkBtn.addEventListener('click', () => preCheck());
    ui.checkDone.addEventListener('click', stopPreCheck);
    win.addEventListener('pagehide', stopPreCheck);
    ui.hangup.addEventListener('click', async () => { stopAv(false); await refreshAv(); });
    V.REACTIONS.forEach((r) => { const b = doc.createElement('button'); b.type = 'button'; b.dataset.r = r; b.textContent = r; b.setAttribute('aria-label', `React ${r}`); ui.reacts.append(b); });
    if (app.av.jam) { ui.jamNote.hidden = false; ui.mic.textContent = 'Talk (browser mic)'; }
    paintControls();
    { const saved = prefs().bg; if (saved && saved !== 'none') app.av.bg.choice = saved; }
    ui.bgSupport.textContent = deviceStrength() === 'no' ? 'This device can’t do backgrounds.' : '';


    /* ---------------- Bob Ross Paint-Along ---------------- */
    function setBob(on, byUser) {
        app.bob.on = Boolean(on);
        if (byUser) app.bob.touched = true;
        doc.body.classList.toggle('bob-mode', app.bob.on);
        ui.bob.hidden = !app.bob.on;
        ui.bobToggle.setAttribute('aria-pressed', String(app.bob.on));
        ui.bobToggle.textContent = app.bob.on ? 'Leave Bob mode' : 'Paint along with Bob';
        if (app.bob.on) {
            if (!BOB.PALETTE.some((p) => p.hex === color)) pickColor(BOB.PALETTE[1].hex);
            const details = ui.bob.querySelector('details');
            if (details && win.matchMedia && win.matchMedia('(max-width: 820px)').matches) details.open = false;
        }
    }
    function currentEpisode() {
        const v = app.state.video;
        return v && v.source && v.source.kind === 'yt' ? BOB.findEpisode(v.source.id) : null;
    }
    function showEpisode() {
        const ep = currentEpisode();
        if (ep && !app.bob.on && !app.bob.touched) setBob(true);
        ui.bobNow.textContent = ep ? `Now painting: ${ep.title} · ${BOB.label(ep)}` : 'No happy accidents yet. The host picks an episode.';
        ui.bobEpisodes.querySelectorAll('.ep').forEach((b) => b.setAttribute('aria-current', String(Boolean(ep) && b.dataset.bobEp === ep.id)));
        const playing = !app.state.video || Boolean(app.state.video.playing);
        ui.bobHold.setAttribute('aria-pressed', String(!playing));
        ui.bobHold.textContent = playing ? 'Hold up! Pause for everyone' : 'Back to painting';
    }
    BOB.EPISODES.forEach((ep) => {
        const li = doc.createElement('li');
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'ep';
        b.dataset.bobEp = ep.id;
        const t = doc.createElement('b');
        t.textContent = ep.title;
        const m = doc.createElement('span');
        m.className = 'meta';
        m.textContent = `${BOB.label(ep)} · ${ep.level}`;
        const d = doc.createElement('span');
        d.className = 'blurb';
        d.textContent = ep.blurb;
        b.append(t, m, d);
        b.addEventListener('click', () => hostLoad({ kind: 'yt', id: ep.id }));
        li.append(b);
        ui.bobEpisodes.append(li);
    });
    ui.bobToggle.addEventListener('click', () => setBob(!app.bob.on, true));
    ui.bobHold.addEventListener('click', async () => {
        const v = app.state.video;
        if (!app.isHost || !v) return;
        const pos = player.readyKey === `${v.source.kind}:${v.source.id}` ? localTime() : H.expectedPosition(v, app.clock.relayNow());
        if (await hostPublish(v.source, !v.playing, pos)) {
            await syncToState(true);
            say(v.playing ? 'Paused for everyone. Beat the devil out of that brush.' : 'Back to painting.');
        }
    });
    ui.bobRewind.addEventListener('click', async () => {
        const v = app.state.video;
        if (!app.isHost || !v) return;
        const current = player.readyKey === `${v.source.kind}:${v.source.id}` ? localTime() : H.expectedPosition(v, app.clock.relayNow());
        if (await hostPublish(v.source, v.playing, Math.max(0, current - 15))) {
            await syncToState(true);
            say('Rewound 15 seconds for everyone.');
        }
    });
    ui.bobCatchup.addEventListener('click', async () => {
        await syncToState(true, true);
        if (!app.ended && !player.failedKey) say('Caught up with the host.');
    });
    ui.bobNudge.addEventListener('click', async () => {
        if (Date.now() - app.bob.lastNudge < 10000) { say('Hang tight, the host already got your nudge.'); return; }
        app.bob.lastNudge = Date.now();
        await send({ type: 'nudge' });
        say('Told the host you need a sec.');
    });
    showEpisode();
    app.setBob = setBob;

    start();
}(window, document));
