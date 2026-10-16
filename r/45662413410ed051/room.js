/* Stalemate Hang Out room. Hidden preview: not linked from the public site.
 * Draw + synced video + chat over an end-to-end encrypted relay, plus an opt-in
 * peer-to-peer camera/mic mesh for up to 8 people. No media ever touches the relay. */
(function hangoutRoom(win, doc) {
    'use strict';

    const H = win.HangoutCore;
    const V = win.HangoutVideo;
    const $ = (sel) => doc.querySelector(sel);
    // Capture once; each receiver gets it scaled for how big they show us. Most people are on
    // phones, so phones and low-power devices default lighter (battery + cell data).
    const PHONE = /Mobi|Android|iPhone|iPad/.test(navigator.userAgent) || (navigator.hardwareConcurrency || 8) < 4;
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
        mic: $('[data-mic]'), cam: $('[data-cam]'), hangup: $('[data-hangup]'), ask: $('[data-ask]'),
        askTitle: $('[data-ask-title]'), askCopy: $('[data-ask-copy]'), askYes: $('[data-ask-yes]'), askNo: $('[data-ask-no]'),
        yt: $('[data-yt]'), file: $('[data-file]'), tap: $('[data-tap]'),
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
        hostPub: null, hostPriv: null, isHost: false, lastHostSeq: 0, lastVideoSigned: null,
        names: new Map(), name: '', snapshotDone: false, connected: false, retries: 0,
        bob: { on: false, touched: false, lastNudge: 0 },
        av: {
            stream: null, rawCam: null, mic: false, cam: false, canvas: false, screen: null, hand: null, away: false, music: false,
            jam: params.get('kind') === 'jam', asked: {}, view: 'grid', pin: null, spot: null, locked: false, kicked: false,
            canvasPeers: new Set(), camPeers: new Set(), micPeers: new Set(), screenPeers: new Set(), awayPeers: new Set(), hands: {},
            peers: new Set(), pcs: new Map(), ice: null, relayed: new Set(), removed: new Set(), lockedOut: new Set(), hidden: new Set(),
            levels: {}, meters: new Map(), ac: null, speaker: { id: null, since: 0 }, wantSent: new Map(), reactTimes: [], peerReacts: new Map(),
            mods: {}, bg: { choice: 'none', proc: null, el: null, frames: [], loading: false, light: false }, sink: null, lock: null
        }
    };
    win.__hangout = app; // test hook, read-only use

    function say(text) { ui.status.textContent = text; }
    function setGate(text) { ui.gateStatus.textContent = text; }

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
        while (pace.queue.length && app.ws && app.ws.readyState === 1 && paceTake()) app.ws.send(pace.queue.shift().frame);
        if (pace.queue.length) pace.timer = win.setTimeout(paceFlush, 150);
    }
    async function send(obj) {
        if (!app.ws || app.ws.readyState !== 1) return;
        const frame = JSON.stringify(await H.seal(app.key, obj));
        pace.queue = V.enqueue(pace.queue, { frame, ice: obj.type === 'rtc' && Boolean(obj.ice) }, QUEUE_MAX);
        if (!pace.timer) paceFlush();
    }

    if (isLocal) { win.__hangoutSend = send; win.__hangoutPace = pace; } // local test hooks only (localhost)

    function connect() {
        if (!relayBase) {
            setGate('The room server isn’t switched on yet. Nothing to join.');
            return;
        }
        const url = `${relayBase.replace(/\/$/, '')}/room?room=${app.roomId}&preview=${encodeURIComponent(previewKey)}`;
        setGate('Connecting…');
        const ws = new WebSocket(url);
        app.ws = ws;
        ws.onmessage = (event) => onRelay(event.data);
        ws.onclose = (event) => {
            if (app.ws !== ws) return;
            app.connected = false;
            app.lastClose = event.code;
            // Dropped mid-hang (Wi-Fi blip, phone switching networks): retry a few times with backoff.
            if (app.myId && event.code !== 4429 && event.code < 4400 && app.retries < 5) {
                app.retries += 1;
                say(`Lost the room for a sec. Reconnecting (${app.retries}/5)…`);
                Array.from(app.av.pcs.keys()).forEach(closePc);
                app.av.peers.clear();
                win.setTimeout(connect, Math.min(8000, 500 * 2 ** app.retries));
                return;
            }
            const why = event.code === 4429 ? 'You’ve hit this room’s message limit for today.'
                : app.myId ? 'Lost the room. Reload to get back in.'
                    : 'Couldn’t get in. The link may be wrong, the room may be full, or the room server is resting for today.';
            if (app.myId) say(why); else setGate(why);
            stopAv();
        };
    }

    async function onRelay(raw) {
        let frame;
        try { frame = JSON.parse(raw); } catch (error) { return; }
        if (Number.isFinite(frame.t)) app.clock.sample(frame.t);
        if (frame.welcome) {
            const again = Boolean(app.myId);
            const oldId = app.myId;
            app.myId = frame.id;
            app.connected = true;
            app.retries = 0;
            if (again) { say('Back in.'); app.av.wantSent.clear(); } else enterRoom();
            showPeers(frame.peers);
            await send({ type: 'hello', name: app.name, av: avFlags() });
            if (again && oldId !== frame.id) await send({ type: 'gone', id: oldId });
            win.setTimeout(() => { app.snapshotDone = true; }, 1500);
            return;
        }
        if (frame.slow) { say('Whoa, slow down a sec.'); return; }
        if (Number.isFinite(frame.peers) && !frame.c) { showPeers(frame.peers); pruneNames(); return; }
        if (!frame.c) return;
        let msg;
        try { msg = await H.open(app.key, frame); } catch (error) { return; }
        await handle(msg, { t: frame.t, from: frame.from });
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
        case 'hello':
            app.names.set(meta.from, String(msg.name || 'Someone').slice(0, 24));
            showPeers(app.names.size + 1);
            noteAv(meta.from, msg.av);
            if (!msg.reply) {
                await send({ type: 'hello', reply: true, to: meta.from, name: app.name, av: avFlags() });
                win.setTimeout(() => sendSnapshot(meta.from), app.isHost ? 0 : 150 + Math.random() * 400);
            }
            return;
        case 'bye':
            app.names.delete(meta.from);
            noteAv(meta.from, null);
            closePc(meta.from);
            showPeers(app.names.size + 1);
            return;
        case 'snapshot':
            if (app.snapshotDone) return;
            app.snapshotDone = true;
            H.apply(app.state, { type: 'snapshot', state: { strokes: msg.strokes, chat: msg.chat } });
            if (msg.video && await verifyHost(msg.video.signed)) acceptVideo(msg.video.signed, msg.video.t);
            for (const mod of (Array.isArray(msg.mods) ? msg.mods.slice(0, 4) : [])) {
                if (mod && mod.body && V.HOST_KINDS.includes(mod.body.kind) && await verifyHost(mod)) applyHostAction(mod.body, mod, false);
            }
            redraw();
            renderChat();
            return;
        case 'stroke':
            if (H.apply(app.state, msg) === 'draw') drawStroke(app.state.strokes.find((s) => s.id === msg.stroke.id));
            return;
        case 'chat':
            H.apply(app.state, msg, meta);
            renderChat();
            return;
        case 'host':
            if (!(await verifyHost(msg))) return;
            if (!(msg.body.seq > app.lastHostSeq)) return; // replay guard
            app.lastHostSeq = msg.body.seq;
            if (msg.body.kind === 'clear') { H.apply(app.state, { type: 'clear' }); redraw(); say('The host wiped the canvas.'); }
            if (msg.body.kind === 'video') acceptVideo(msg, meta.t);
            if (V.HOST_KINDS.includes(msg.body.kind)) applyHostAction(msg.body, msg, false);
            return;
        case 'av':
            noteAv(meta.from, msg.av);
            return;
        case 'nudge':
            if (app.isHost) say(`${app.names.get(meta.from) || 'Someone'} needs a sec. Hit “Hold up!” to pause for everyone.`);
            return;
        case 'rtc':
            await onRtc(meta.from, msg);
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

    function sendSnapshot(to) {
        const video = app.lastVideoSigned;
        const mods = [app.av.mods.lock, app.av.mods.spot].filter(Boolean);
        send({ type: 'snapshot', to, strokes: app.state.strokes.slice(-400), chat: app.state.chat.slice(-50), video, mods });
    }

    /* ---------------- gate / enter ---------------- */
    function enterRoom() {
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
        return [Math.min(1, Math.max(0, (event.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (event.clientY - r.top) / r.height))];
    }
    function flush() {
        flushTimer = null;
        if (!live || !pending.length) return;
        send({ type: 'stroke', stroke: { id: live.id, color: live.color, size: live.size, pts: pending } });
        pending = [];
    }
    ui.canvas.addEventListener('pointerdown', (event) => {
        ui.canvas.setPointerCapture(event.pointerId);
        live = { id: `${app.myId}-${Date.now().toString(36)}`, color, size: Number(ui.size.value), pts: [point(event)] };
        pending = [live.pts[0]];
        H.apply(app.state, { type: 'stroke', stroke: { ...live } });
        drawStroke(app.state.strokes[app.state.strokes.length - 1]);
    });
    ui.canvas.addEventListener('pointermove', (event) => {
        if (!live) return;
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
        if (!app.isHost) return;
        H.apply(app.state, { type: 'clear' });
        redraw();
        app.lastHostSeq = Math.max(app.lastHostSeq + 1, Date.now());
        await send(await signHost({ kind: 'clear', seq: app.lastHostSeq }));
    });
    ui.save.addEventListener('click', () => {
        const a = doc.createElement('a');
        a.download = 'stalemate-hangout.png';
        a.href = ui.canvas.toDataURL('image/png');
        a.click();
    });

    /* ---------------- synced video (host drives) ---------------- */
    const player = { kind: null, yt: null, ytReady: null, applying: 0, currentKey: '' };

    function loadYouTubeApi() {
        if (player.ytReady) return player.ytReady;
        player.ytReady = new Promise((resolve) => {
            win.onYouTubeIframeAPIReady = () => resolve(win.YT);
            const s = doc.createElement('script');
            s.src = 'https://www.youtube.com/iframe_api';
            doc.head.append(s);
        });
        return player.ytReady;
    }

    async function ensureSource(source) {
        const key = `${source.kind}:${source.id}`;
        if (player.currentKey === key) return;
        player.currentKey = key;
        if (source.kind === 'file') {
            if (player.yt) player.yt.stopVideo();
            ui.yt.hidden = true;
            ui.file.hidden = false;
            ui.file.src = H.FILE_SOURCES[source.id].src;
            player.kind = 'file';
            return;
        }
        ui.file.pause();
        ui.file.hidden = true;
        ui.yt.hidden = false;
        player.kind = 'yt';
        const YT = await loadYouTubeApi();
        if (!player.yt) {
            await new Promise((resolve) => {
                player.yt = new YT.Player(ui.yt, {
                    videoId: source.id,
                    playerVars: { playsinline: 1, rel: 0, origin: win.location.origin },
                    events: { onReady: resolve, onStateChange: onYtState }
                });
            });
            ui.yt = doc.getElementById('yt-player') || ui.yt;
        } else {
            player.yt.cueVideoById(source.id);
        }
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
        const b = signed.body;
        if (H.apply(app.state, { type: 'video', source: b.source, playing: b.playing, pos: b.pos }, { t }) !== 'video') return;
        app.lastVideoSigned = { signed, t };
        app.lastHostSeq = Math.max(app.lastHostSeq, b.seq || 0);
        showEpisode();
        await syncToState(true);
    }

    async function syncToState(force) {
        const v = app.state.video;
        if (!v) return;
        await ensureSource(v.source);
        const want = H.expectedPosition(v, app.clock.relayNow());
        if (force || H.needsCorrection(localTime(), want)) seekTo(want);
        if (v.playing && !localPlaying()) playLocal();
        if (!v.playing && localPlaying()) pauseLocal();
    }
    win.setInterval(() => { if (!app.isHost || !localPlaying()) syncToState(false); }, 2000);

    async function hostPublish(source, playing, pos) {
        if (!app.isHost) return;
        app.lastHostSeq = Math.max(app.lastHostSeq + 1, Date.now());
        const signed = await signHost({ kind: 'video', seq: app.lastHostSeq, source, playing, pos: Math.max(0, pos) });
        const t = app.clock.relayNow();
        H.apply(app.state, { type: 'video', source, playing, pos }, { t });
        app.lastVideoSigned = { signed, t };
        showEpisode();
        await send(signed);
    }

    function onLocalChange() {
        if (!app.isHost || Date.now() < player.applying || !app.state.video) return;
        hostPublish(app.state.video.source, localPlaying(), localTime());
    }
    function onYtState(event) {
        if (event.data === 1 || event.data === 2) onLocalChange();
    }
    ['play', 'pause', 'seeked'].forEach((e) => ui.file.addEventListener(e, onLocalChange));
    ui.tap.addEventListener('click', () => { ui.tap.hidden = true; syncToState(true); });

    async function hostLoad(source) {
        if (!app.isHost) { say('Only the person who started the room changes the video.'); return; }
        await ensureSource(source);
        await hostPublish(source, true, 0);
        seekTo(0);
        playLocal();
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
        layout();
    }

    function ask(title, copy) {
        return new Promise((resolve) => {
            ui.askTitle.textContent = title;
            ui.askCopy.textContent = copy;
            const done = (v) => { ui.ask.close(); ui.askYes.onclick = null; ui.askNo.onclick = null; resolve(v); };
            ui.askYes.onclick = () => done(true);
            ui.askNo.onclick = () => done(false);
            if (ui.ask.showModal) ui.ask.showModal(); else resolve(win.confirm(`${title}\n\n${copy}`));
        });
    }

    async function iceServers() {
        if (app.av.ice) return app.av.ice;
        app.av.ice = STUN;
        if (!turnUrl) return app.av.ice;
        try {
            const res = await fetch(turnUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ preview: previewKey, room: app.roomId }) });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.iceServers)) app.av.ice = STUN.concat(data.iceServers);
            } else {
                say('The video relay is out of free juice for now. Faces only work when browsers can connect directly.');
            }
        } catch (error) { /* fail closed to direct-only */ }
        return app.av.ice;
    }

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

    function setTrack(kind, track) {
        if (!app.av.stream) app.av.stream = new MediaStream();
        app.av.stream.getTracks().filter((t) => t.kind === kind).forEach((t) => app.av.stream.removeTrack(t));
        if (track) app.av.stream.addTrack(track);
    }
    function stopRaw(kind) {
        if (kind === 'video') {
            if (app.av.bg.proc) { const p = app.av.bg.proc; app.av.bg.proc = null; p.destroy().catch(() => {}); }
            if (app.av.rawCam) { app.av.rawCam.stop(); app.av.rawCam = null; }
        }
        if (app.av.stream) app.av.stream.getTracks().filter((t) => t.kind === kind).forEach((t) => t.stop());
        setTrack(kind, null);
    }

    async function toggle(kind) {
        const turningOn = !app.av[kind];
        if (kind === 'cam' && app.av.canvas) { await toggleCanvasCam(); return; }
        if (turningOn) {
            if (app.av.kicked) { say('The host took you off faces in this room. Chat and draw still work.'); return; }
            if (app.av.locked && !(app.av.mic || app.av.cam)) { say('The host locked faces for now. Chat and draw still work.'); return; }
            if (!(app.av.mic || app.av.cam) && avCount() >= V.MAX_CAMS) { say(`Faces are full (${V.MAX_CAMS} max). Chat and draw still work.`); return; }
            if (!app.av.asked[kind]) {
                const ok = await ask(kind === 'cam' ? 'Turn on your camera?' : 'Turn on your mic?',
                    kind === 'cam'
                        ? 'Tap Allow on the next pop-up. Only this room sees you.'
                        : app.av.jam
                            ? 'This is for talking between songs. Your playing goes through WebJam, so keep this off while you play or people hear you twice. Your browser will ask: tap Allow.'
                            : 'Tap Allow on the next pop-up. Only this room hears you.');
                if (!ok) return;
            }
            try {
                if (kind === 'cam') {
                    const got = await navigator.mediaDevices.getUserMedia({ video: camConstraints() });
                    app.av.rawCam = got.getVideoTracks()[0];
                    setTrack('video', app.av.rawCam);
                    if (app.av.bg.choice && app.av.bg.choice !== 'none') setBackground(app.av.bg.choice, true);
                } else {
                    const got = await navigator.mediaDevices.getUserMedia({ audio: V.micConstraints(app.av.music, prefs().mic) });
                    setTrack('audio', got.getAudioTracks()[0]);
                }
                app.av.asked[kind] = true;
                app.av[kind] = true;
                ensureAudioCtx();
            } catch (error) {
                if (kind === 'cam' && !app.av.mic && !app.av.jam) {
                    // No camera (blocked, missing or busy)? Don't strand them: offer voice only.
                    const voice = await ask('Camera’s not available', 'Join with just your voice? You can add the camera later.');
                    if (voice) { app.av.asked.mic = true; await toggle('mic'); }
                    if (app.av.mic) { say('You’re in with voice only. To add video, allow Camera by the address bar, then tap the camera button.'); return; }
                }
                say(kind === 'cam'
                    ? 'Camera’s blocked. Tap the lock or “aA” icon by the address bar, allow Camera, then try again.'
                    : 'Mic’s blocked. Tap the lock or “aA” icon by the address bar, allow Microphone, then try again.');
                return;
            }
        } else {
            if (kind === 'cam' && app.av.screen) await stopScreen(true);
            stopRaw(kind === 'cam' ? 'video' : 'audio');
            app.av[kind] = false;
        }
        await refreshAv();
    }

    /* "Show my real canvas": the back camera, sharper, shown as a rectangle. */
    async function toggleCanvasCam() {
        if (app.av.canvas) {
            stopRaw('video');
            app.av.canvas = false;
            app.av.cam = false;
            await refreshAv();
            return;
        }
        if (app.av.kicked || (app.av.locked && !(app.av.mic || app.av.cam))) { say('Faces are locked by the host right now.'); return; }
        if (!(app.av.mic || app.av.cam) && avCount() >= V.MAX_CAMS) { say(`Faces are full (${V.MAX_CAMS} max). Chat and draw still work.`); return; }
        const ok = await ask('Show your real canvas?',
            'Point your camera at your easel, sketchbook or lump of clay. Your browser will ask to use the camera. Tap Allow. On phones we try the back camera. Only people in this room see it.');
        if (!ok) return;
        try {
            const got = await navigator.mediaDevices.getUserMedia({ video: CANVAS_CAM });
            stopRaw('video');
            app.av.rawCam = got.getVideoTracks()[0];
            setTrack('video', app.av.rawCam);
            app.av.cam = true;
            app.av.canvas = true;
        } catch (error) {
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
        let track;
        try {
            const got = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 8, max: 15 }, width: { max: 1920 }, height: { max: 1080 } }, audio: false });
            track = got.getVideoTracks()[0];
        } catch (error) { say('Screen share cancelled.'); return; }
        try { track.contentHint = 'detail'; } catch (error) { /* older browsers */ }
        track.addEventListener('ended', () => stopScreen());
        app.av.screen = track;
        app.av.camWasOn = app.av.cam;
        if (app.av.rawCam && app.av.bg.proc) { const p = app.av.bg.proc; app.av.bg.proc = null; p.destroy().catch(() => {}); }
        if (app.av.rawCam) { app.av.rawCam.stop(); app.av.rawCam = null; }
        setTrack('video', track);
        app.av.cam = true;
        await refreshAv();
        say('You’re sharing your screen. Everyone sees it big.');
    }
    async function stopScreen(silent) {
        const t = app.av.screen;
        if (!t) return;
        app.av.screen = null;
        t.stop();
        setTrack('video', null);
        app.av.cam = false;
        if (app.av.camWasOn && !silent) { app.av.asked.cam = true; await toggle('cam'); return; }
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
        const plan = V.planUplink({ viewers, phone: PHONE, cams: camCount(), screen: Boolean(app.av.screen), jam: app.av.jam });
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

    function openPc(id) {
        if (app.av.pcs.has(id) || app.av.removed.has(id)) return;
        const pc = new RTCPeerConnection({ iceServers: app.av.ice || STUN });
        const conn = navigator.connection || {};
        const thrifty = Boolean(conn.saveData) || conn.type === 'cellular' || /(^|-)2g|3g/.test(conn.effectiveType || '');
        const entry = { pc, polite: app.myId > id, makingOffer: false, ignoreOffer: false, relayed: false, stream: new MediaStream(), senders: {}, wantHi: false, tier: thrifty ? 'weak' : 'ok', hist: [], restarts: 0, last: null };
        app.av.pcs.set(id, entry);
        pc.onicecandidate = (e) => { if (e.candidate) send({ type: 'rtc', to: id, ice: e.candidate.toJSON() }); };
        pc.onnegotiationneeded = async () => {
            try {
                entry.makingOffer = true;
                const offer = await pc.createOffer();
                if (pc.signalingState !== 'stable') return;
                if (app.av.music) offer.sdp = V.musicSdp(offer.sdp);
                await pc.setLocalDescription(offer);
                await send({ type: 'rtc', to: id, sdp: pc.localDescription.toJSON() });
            } catch (error) { /* retried by next negotiation */ } finally { entry.makingOffer = false; }
        };
        pc.ontrack = (e) => {
            entry.stream.addTrack(e.track);
            e.track.onended = () => entry.stream.removeTrack(e.track);
            if (e.track.kind === 'audio') watchLevel(id, entry.stream);
            layout();
        };
        pc.onconnectionstatechange = () => {
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

    async function onRtc(from, msg) {
        if (app.av.removed.has(from)) return;
        if (!(app.av.mic || app.av.cam) && !app.av.peers.has(from)) return;
        if (!app.av.pcs.has(from)) openPc(from);
        const entry = app.av.pcs.get(from);
        if (!entry) return;
        const pc = entry.pc;
        try {
            if (msg.sdp) {
                const collision = msg.sdp.type === 'offer' && (entry.makingOffer || pc.signalingState !== 'stable');
                entry.ignoreOffer = !entry.polite && collision;
                if (entry.ignoreOffer) return;
                await pc.setRemoteDescription(msg.sdp);
                if (msg.sdp.type === 'offer') {
                    const answer = await pc.createAnswer();
                    if (app.av.music) answer.sdp = V.musicSdp(answer.sdp);
                    await pc.setLocalDescription(answer);
                    await send({ type: 'rtc', to: from, sdp: pc.localDescription.toJSON() });
                }
            } else if (msg.ice) {
                try { await pc.addIceCandidate(msg.ice); } catch (error) { if (!entry.ignoreOffer) throw error; }
            }
        } catch (error) { /* bad signaling from a peer; ignore */ }
    }

    function closePc(id) {
        const entry = app.av.pcs.get(id);
        if (entry) { entry.pc.close(); app.av.pcs.delete(id); }
        app.av.relayed.delete(id);
        delete app.av.levels[id];
        const meter = app.av.meters.get(id);
        if (meter) { try { meter.src.disconnect(); } catch (error) { /* gone */ } app.av.meters.delete(id); }
        const tile = ui.tiles.querySelector(`[data-tile="${CSS.escape(id)}"]`);
        if (tile) tile.remove();
        layout();
    }

    function stopAv() {
        if (app.av.screen) { app.av.screen.stop(); app.av.screen = null; }
        if (app.av.bg.proc) { const p = app.av.bg.proc; app.av.bg.proc = null; p.destroy().catch(() => {}); }
        if (app.av.rawCam) { app.av.rawCam.stop(); app.av.rawCam = null; }
        if (app.av.stream) app.av.stream.getTracks().forEach((t) => t.stop());
        app.av.stream = null;
        app.av.mic = false;
        app.av.cam = false;
        app.av.canvas = false;
        app.av.hand = null;
        Array.from(app.av.pcs.keys()).forEach(closePc);
        const me = ui.tiles.querySelector('[data-tile="me"]');
        if (me) me.remove();
        wakeLock(false);
    }

    /* ---------------- active speaker (Web Audio level meters) ---------------- */
    function ensureAudioCtx() {
        if (app.av.ac || !win.AudioContext) return app.av.ac;
        try { app.av.ac = new win.AudioContext(); } catch (error) { app.av.ac = null; }
        if (app.av.ac && app.av.stream && app.av.mic) watchLevel('me', app.av.stream);
        return app.av.ac;
    }
    function watchLevel(id, stream) {
        const ac = app.av.ac;
        if (!ac || !stream.getAudioTracks().length) return;
        const old = app.av.meters.get(id);
        if (old) { try { old.src.disconnect(); } catch (error) { /* gone */ } }
        try {
            const src = ac.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
            const an = ac.createAnalyser();
            an.fftSize = 512;
            src.connect(an);
            app.av.meters.set(id, { src, an, buf: new Float32Array(an.fftSize) });
        } catch (error) { /* no audio graph */ }
    }
    win.setInterval(() => {
        if (!app.av.meters.size) return;
        if (app.av.mic && app.av.stream && !app.av.meters.has('me')) watchLevel('me', app.av.stream);
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
        await send({ type: 'report', about: id, name: peerName(id) });
        app.av.hidden.add(id);
        layout();
        say(`Reported ${peerName(id)} to the host and hid them for you.`);
    }

    /* ---------------- host moderation (signed by the room creator) ---------------- */
    async function hostAct(action) {
        if (!app.isHost) return;
        app.lastHostSeq = Math.max(app.lastHostSeq + 1, Date.now());
        const body = V.cleanHostAction(Object.assign({}, action, { seq: app.lastHostSeq }));
        if (!body) return;
        const signed = await signHost(body);
        applyHostAction(body, signed, true);
        await send(signed);
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
            if (a.target === me && app.av.mic) { stopRaw('audio'); app.av.mic = false; refreshAv(); say('The host muted you. You can unmute when you’re ready.'); }
        } else if (a.kind === 'camoff') {
            if ((a.target === me || a.target === '*') && app.av.cam) {
                if (app.av.screen) { app.av.screen.stop(); app.av.screen = null; }
                stopRaw('video'); app.av.cam = false; app.av.canvas = false; refreshAv();
                say('The host turned your camera off.');
            } else if (a.target === '*' && mine) say('Cameras off for everyone.');
        } else if (a.kind === 'remove') {
            if (a.target === me) { app.av.kicked = true; stopAv(); refreshAv(); say('The host took you off faces in this room. Chat and draw still work.'); }
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
        try {
            if (kind === 'cam' && app.av.cam && !app.av.screen && !app.av.canvas) {
                const got = await navigator.mediaDevices.getUserMedia({ video: Object.assign({}, CAM, { deviceId: { exact: deviceId } }) });
                const old = app.av.rawCam;
                app.av.rawCam = got.getVideoTracks()[0];
                if (app.av.bg.proc) await app.av.bg.proc.restart({ kind: 'video', track: app.av.rawCam, element: app.av.bg.el });
                setTrack('video', app.av.bg.proc ? app.av.bg.proc.processedTrack : app.av.rawCam);
                if (old) old.stop();
            }
            if (kind === 'mic' && app.av.mic) await restartMic();
            for (const entry of app.av.pcs.values()) syncTracks(entry);
            layout();
        } catch (error) { say('Couldn’t switch to that device. Is another app using it?'); }
    }
    async function restartMic() {
        const got = await navigator.mediaDevices.getUserMedia({ audio: V.micConstraints(app.av.music, prefs().mic) });
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
        if (/Mobi|Android|iPhone|iPad/.test(navigator.userAgent) && app.av.cam && !app.av.screen && !inPip) {
            app.av.away = hidden;
            applyEncoding();
            send({ type: 'av', av: avFlags() });
        }
        if (!hidden && (app.av.mic || app.av.cam)) wakeLock(true);
    });

    /* ---------------- pre-join check ---------------- */
    async function preCheck() {
        ui.check.hidden = false;
        ui.checkOut.textContent = 'Checking…';
        const lines = [];
        let stream = null;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: camConstraints(), audio: V.micConstraints(false, prefs().mic) });
            ui.checkVideo.srcObject = stream;
            lines.push('✅ Camera works.');
            const ac = new (win.AudioContext || win.webkitAudioContext)();
            const an = ac.createAnalyser();
            ac.createMediaStreamSource(stream).connect(an);
            const buf = new Float32Array(an.fftSize);
            const tick = () => {
                if (!ui.checkVideo.srcObject) { ac.close(); return; }
                an.getFloatTimeDomainData(buf);
                let peak = 0;
                buf.forEach((x) => { peak = Math.max(peak, Math.abs(x)); });
                ui.checkMeter.value = Math.min(1, peak * 3);
                win.requestAnimationFrame(tick);
            };
            tick();
            lines.push('🎤 Say something: the bar should jump.');
        } catch (error) {
            lines.push('⚠️ Camera or mic is blocked. Allow them by the address bar if you want faces. Chat and draw work either way.');
        }
        ui.checkOut.textContent = lines.join(' ');
        try {
            const t0 = performance.now();
            const pc = new RTCPeerConnection({ iceServers: STUN });
            pc.createDataChannel('x');
            const found = new Promise((resolve) => {
                pc.onicecandidate = (e) => { if (e.candidate && / srflx /.test(e.candidate.candidate)) resolve(true); if (!e.candidate) resolve(false); };
                win.setTimeout(() => resolve(false), 4000);
            });
            await pc.setLocalDescription(await pc.createOffer());
            const ok = await found;
            pc.close();
            const ms = Math.round(performance.now() - t0);
            lines.push(ok ? `🌐 Network looks good for direct video (${ms} ms).` : '🌐 Your network may block direct video (work or school Wi-Fi often does). Chat, draw and watch still work.');
        } catch (error) { lines.push('🌐 Couldn’t test the network.'); }
        if (app.av.jam) lines.push('🎸 Jamming? Plug in an Ethernet cable and use WebJam for the music. Wired beats Wi-Fi by a mile.');
        else lines.push('Tip: headphones stop echo. A wired (Ethernet) connection beats Wi-Fi.');
        ui.checkOut.textContent = lines.join(' ');
        ui.checkDone.onclick = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); ui.checkVideo.srcObject = null; ui.check.hidden = true; };
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
    ui.hangup.addEventListener('click', async () => { stopAv(); await refreshAv(); });
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
        const pos = localTime();
        if (v.playing) { pauseLocal(); await hostPublish(v.source, false, pos); say('Paused for everyone. Beat the devil out of that brush.'); }
        else { await hostPublish(v.source, true, pos); playLocal(); say('Back to painting.'); }
    });
    ui.bobRewind.addEventListener('click', async () => {
        const v = app.state.video;
        if (!app.isHost || !v) return;
        const pos = Math.max(0, localTime() - 15);
        seekTo(pos);
        await hostPublish(v.source, v.playing, pos);
        say('Rewound 15 seconds for everyone.');
    });
    ui.bobCatchup.addEventListener('click', async () => { ui.tap.hidden = true; await syncToState(true); say('Caught up with the host.'); });
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
