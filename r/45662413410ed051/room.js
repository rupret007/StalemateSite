/* Stalemate Hang Out room. Hidden preview: not linked from the public site.
 * Draw + synced video + chat over an end-to-end encrypted relay, plus an opt-in
 * peer-to-peer camera/mic mesh for up to 4 people. No media ever touches the relay. */
(function hangoutRoom(win, doc) {
    'use strict';

    const H = win.HangoutCore;
    const $ = (sel) => doc.querySelector(sel);
    const AV_MAX = 4;
    const CAM = { width: { ideal: 320, max: 320 }, height: { ideal: 240, max: 240 }, frameRate: { ideal: 15, max: 15 } };
    const CANVAS_CAM = { width: { ideal: 640, max: 640 }, height: { ideal: 480, max: 480 }, frameRate: { ideal: 15, max: 15 }, facingMode: { ideal: 'environment' } };
    const CAM_BPS = 250000;
    const CAM_RELAY_BPS = 100000;
    const MIC_BPS = 32000;
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
        canvasCam: $('[data-canvas-cam]')
    };
    const BOB = win.BobRoss;

    const app = {
        state: H.emptyState(), clock: H.createClock(), ws: null, myId: null, key: null, roomId: null,
        hostPub: null, hostPriv: null, isHost: false, lastHostSeq: 0, lastHostSigned: null, lastVideoSigned: null,
        names: new Map(), name: '', snapshotDone: false, snapshotFrom: null, snapshotHasSeqProof: false, connected: false,
        bob: { on: false, touched: false, lastNudge: 0 },
        av: { stream: null, mic: false, cam: false, canvas: false, canvasPeers: new Set(), peers: new Set(), pcs: new Map(), ice: null, relayed: new Set() }
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
    async function send(obj) {
        if (!app.ws || app.ws.readyState !== 1) return;
        const frame = await H.seal(app.key, obj);
        app.ws.send(JSON.stringify(frame));
    }

    function connect() {
        if (!relayBase) {
            setGate('The room server isn’t switched on yet. Nothing to join.');
            return;
        }
        const url = `${relayBase.replace(/\/$/, '')}/room?room=${app.roomId}`;
        setGate('Connecting…');
        const ws = previewKey ? new WebSocket(url, [previewKey]) : new WebSocket(url);
        app.ws = ws;
        ws.onmessage = (event) => onRelay(event.data);
        ws.onclose = (event) => {
            app.connected = false;
            const why = event.code === 4429 ? 'You’ve hit this room’s message limit for today.'
                : app.myId ? 'Lost the room. Reload to get back in.'
                    : 'Couldn’t get in. The link may be wrong, the room may be full, or the room server is resting for today.';
            if (app.myId) say(why); else setGate(why);
            stopAv(true);
        };
    }

    async function onRelay(raw) {
        let frame;
        try { frame = JSON.parse(raw); } catch (error) { return; }
        if (Number.isFinite(frame.t)) app.clock.sample(frame.t);
        if (frame.welcome) {
            app.myId = frame.id;
            app.connected = true;
            enterRoom();
            app.snapshotDone = false;
            app.snapshotFrom = null;
            showPeers(frame.peers);
            await send({ type: 'hello', name: app.name, av: avFlags() });
            return;
        }
        if (frame.slow) { say('Whoa, slow down a sec.'); return; }
        if (Number.isFinite(frame.peers) && !frame.c) {
            if (frame.left) {
                app.names.delete(frame.left);
                noteAv(frame.left, null);
            }
            showPeers(frame.peers);
            return;
        }
        if (!frame.c) return;
        let msg;
        try { msg = await H.open(app.key, frame); } catch (error) { return; }
        await handle(msg, { t: frame.t, from: frame.from });
    }

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
            showPeers(app.names.size + 1);
            return;
        case 'snapshot': {
            const seqSigned = msg.lastHostSeqSigned;
            const hasSeqProof = Boolean(
                seqSigned
                && Number.isFinite(seqSigned.body?.seq)
                && await verifyHost(seqSigned)
            );
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
            if (msg.done || !msg.chunk) app.snapshotDone = true;
            H.apply(app.state, {
                type: 'snapshot',
                state: { strokes: msg.strokes, chat: msg.chat, append: Boolean(msg.chunk && !msg.first) }
            });
            if (
                msg.video?.signed?.body?.kind === 'video'
                && await verifyHost(msg.video.signed)
            ) {
                const signedT = Number(msg.video.signed.body.t);
                if (Number.isFinite(signedT)) acceptVideo(msg.video.signed, signedT);
            }
            redraw();
            renderChat();
            return;
        }
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
            app.lastHostSigned = msg;
            if (msg.body.kind === 'clear') { H.apply(app.state, { type: 'clear' }); redraw(); say('The host wiped the canvas.'); }
            if (msg.body.kind === 'video') acceptVideo(msg, meta.t);
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
        default:
        }
    }

    async function sendSnapshot(to) {
        const video = app.lastVideoSigned;
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
        chunks.forEach((chunk, i) => {
            const isLast = i === chunks.length - 1;
            send({
                type: 'snapshot',
                to,
                strokes: chunk,
                chat: isLast ? app.state.chat.slice(-50) : undefined,
                video: isLast ? video : undefined,
                lastHostSeqSigned: lastHostSeqSigned || undefined,
                chunk: chunks.length > 1,
                first: i === 0,
                done: isLast
            });
        });
    }

    /* ---------------- gate / enter ---------------- */
    function enterRoom() {
        ui.gate.hidden = true;
        ui.room.hidden = false;
        doc.body.classList.toggle('is-host', app.isHost);
        ui.hostNote.textContent = app.isHost ? 'You started this room, so you drive the video and the wipe.' : 'The person who started the room drives the video.';
        say('You’re in. Say hi?');
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
        ui.enter.addEventListener('click', async () => {
            ui.enter.disabled = true;
            app.name = (ui.name.value || '').trim().slice(0, 24) || `Punk #${Math.floor(10 + Math.random() * 89)}`;
            try {
                if (!invite) invite = await makeRoom();
                await loadIdentity(invite);
                await iceServers();
                connect();
            } catch (error) {
                setGate('That invite link looks broken. Ask for a fresh one.');
                ui.enter.disabled = false;
            }
        });
        if (invite && params.get('autojoin') === '1') ui.enter.click();
    }

    ui.copy.addEventListener('click', async () => {
        const linkUrl = new URL(win.location.href);
        linkUrl.searchParams.delete('preview');
        const link = linkUrl.href;
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
        } else if (app.state.video?.playing) {
            player.yt.loadVideoById({ videoId: source.id, startSeconds: 0 });
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
        const relayT = Number.isFinite(Number(b.t)) ? Number(b.t) : t;
        if (H.apply(app.state, { type: 'video', source: b.source, playing: b.playing, pos: b.pos }, { t: relayT }) !== 'video') return;
        app.lastVideoSigned = { signed, t: relayT };
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
        const t = app.clock.relayNow();
        const signed = await signHost({ kind: 'video', seq: app.lastHostSeq, source, playing, pos: Math.max(0, pos), t });
        H.apply(app.state, { type: 'video', source, playing, pos }, { t });
        app.lastVideoSigned = { signed, t };
        showEpisode();
        await send(signed);
    }

    function onLocalChange() {
        if (!app.isHost || !app.state.video) return;
        const v = app.state.video;
        const playing = localPlaying();
        const pos = localTime();
        if (Date.now() < player.applying) {
            const want = v.playing ? H.expectedPosition(v, app.clock.relayNow()) : v.pos;
            if (playing === v.playing && Math.abs(pos - want) < 2) return;
        }
        hostPublish(v.source, playing, pos);
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

    /* ---------------- faces & voices: opt-in P2P mesh ---------------- */
    function avFlags() { return { mic: app.av.mic, cam: app.av.cam, canvas: app.av.canvas }; }
    function avCount() { return app.av.peers.size + ((app.av.mic || app.av.cam) ? 1 : 0); }

    function noteAv(from, av) {
        const on = Boolean(av && (av.mic || av.cam));
        if (av && av.canvas) app.av.canvasPeers.add(from); else app.av.canvasPeers.delete(from);
        const t = ui.tiles.querySelector(`[data-tile="${CSS.escape(from)}"]`);
        if (t) t.classList.toggle('tile--canvas', app.av.canvasPeers.has(from));
        if (on) {
            app.av.peers.add(from);
            if (!app.av.pcs.has(from)) openPc(from);
            const entry = app.av.pcs.get(from);
            if (entry) {
                if (av && !av.cam) entry.stream.getVideoTracks().forEach((t) => entry.stream.removeTrack(t));
                pruneStreamTracks(entry.stream);
                renderTile(from, entry.stream, app.names.get(from) || 'Friend');
            }
        } else {
            app.av.peers.delete(from);
            closePc(from);
        }
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
        let servers = STUN;
        if (!turnUrl) { app.av.ice = servers; return servers; }
        try {
            const res = await fetch(turnUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ preview: previewKey, room: app.roomId }) });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.iceServers)) servers = STUN.concat(data.iceServers);
            } else {
                say('The video relay is out of free juice for now. Faces only work when browsers can connect directly.');
            }
        } catch (error) { /* fail closed to direct-only */ }
        app.av.ice = servers;
        return servers;
    }

    async function toggle(kind) {
        const turningOn = !app.av[kind];
        if (kind === 'cam' && app.av.canvas) { await toggleCanvasCam(); return; }
        if (turningOn) {
            if (!(app.av.mic || app.av.cam) && avCount() >= AV_MAX) { say(`Faces are full (${AV_MAX} max). Chat and draw still work.`); return; }
            const ok = await ask(kind === 'cam' ? 'Turn on your camera?' : 'Turn on your mic?',
                kind === 'cam'
                    ? 'Your browser will ask to use your camera. Tap Allow. Only people in this room see you, in a small bubble. Tap the button again to turn it off anytime.'
                    : 'Your browser will ask to use your microphone. Tap Allow. Only people in this room hear you. Headphones stop echo. Tap again to mute anytime.');
            if (!ok) return;
            try {
                const got = await navigator.mediaDevices.getUserMedia(kind === 'cam' ? { video: CAM } : { audio: { echoCancellation: true, noiseSuppression: true } });
                if (!app.av.stream) app.av.stream = new MediaStream();
                got.getTracks().forEach((track) => app.av.stream.addTrack(track));
                app.av[kind] = true;
            } catch (error) {
                say(kind === 'cam'
                    ? 'Camera’s blocked. Tap the lock or “aA” icon by the address bar, allow Camera, then try again.'
                    : 'Mic’s blocked. Tap the lock or “aA” icon by the address bar, allow Microphone, then try again.');
                return;
            }
        } else {
            const want = kind === 'cam' ? 'video' : 'audio';
            app.av.stream.getTracks().filter((t) => t.kind === want).forEach((t) => { t.stop(); app.av.stream.removeTrack(t); });
            app.av[kind] = false;
        }
        await refreshAv();
    }

    /* "Show my real canvas": the back camera, a bit sharper, shown as a rectangle not a bubble. */
    async function toggleCanvasCam() {
        if (app.av.canvas) {
            app.av.stream.getVideoTracks().forEach((t) => { t.stop(); app.av.stream.removeTrack(t); });
            app.av.canvas = false;
            app.av.cam = false;
            await refreshAv();
            return;
        }
        if (!(app.av.mic || app.av.cam) && avCount() >= AV_MAX) { say(`Faces are full (${AV_MAX} max). Chat and draw still work.`); return; }
        const ok = await ask('Show your real canvas?',
            'Point your camera at your easel, sketchbook or lump of clay. Your browser will ask to use the camera. Tap Allow. On phones we try the back camera. Only people in this room see it.');
        if (!ok) return;
        try {
            const got = await navigator.mediaDevices.getUserMedia({ video: CANVAS_CAM });
            if (!app.av.stream) app.av.stream = new MediaStream();
            app.av.stream.getVideoTracks().forEach((t) => { t.stop(); app.av.stream.removeTrack(t); });
            got.getTracks().forEach((track) => app.av.stream.addTrack(track));
            app.av.cam = true;
            app.av.canvas = true;
        } catch (error) {
            say('Camera’s blocked. Tap the lock or “aA” icon by the address bar, allow Camera, then try again.');
            return;
        }
        await refreshAv();
    }

    async function refreshAv() {
        ui.canvasCam.setAttribute('aria-pressed', String(app.av.canvas));
        ui.canvasCam.textContent = app.av.canvas ? 'Stop showing my canvas' : 'Show my real canvas';
        ui.mic.setAttribute('aria-pressed', String(app.av.mic));
        ui.cam.setAttribute('aria-pressed', String(app.av.cam));
        ui.mic.textContent = app.av.mic ? 'Mute my mic' : 'Turn on my mic';
        ui.cam.textContent = app.av.cam ? 'Turn off my camera' : 'Turn on my camera';
        ui.cam.disabled = app.av.canvas;
        ui.hangup.hidden = !(app.av.mic || app.av.cam);
        renderTile('me', app.av.cam ? app.av.stream : null, app.av.canvas ? `${app.name}’s canvas (you)` : `${app.name} (you)`, true);
        await send({ type: 'av', av: avFlags() });
        if (!(app.av.mic || app.av.cam)) Array.from(app.av.pcs.keys()).filter((id) => !app.av.peers.has(id)).forEach(closePc);
        const mesh = (app.av.mic || app.av.cam) ? app.names.keys() : app.av.peers;
        for (const id of mesh) if (!app.av.pcs.has(id)) openPc(id);
        for (const pc of app.av.pcs.values()) syncTracks(pc);
    }

    function syncTracks(entry) {
        const tracks = app.av.stream ? app.av.stream.getTracks() : [];
        for (const sender of entry.pc.getSenders()) {
            if (sender.track && !tracks.includes(sender.track)) entry.pc.removeTrack(sender);
        }
        const have = entry.pc.getSenders().map((s) => s.track);
        tracks.filter((t) => !have.includes(t)).forEach((t) => {
            const sender = entry.pc.addTrack(t, app.av.stream);
            capSender(sender, entry.relayed);
        });
    }

    function capSender(sender, relayed) {
        if (!sender.track) return;
        const p = sender.getParameters();
        if (!p.encodings || !p.encodings.length) p.encodings = [{}];
        if (sender.track.kind === 'video') {
            p.encodings[0].maxBitrate = relayed ? CAM_RELAY_BPS : CAM_BPS;
            p.encodings[0].maxFramerate = relayed ? 10 : 15;
            p.encodings[0].scaleResolutionDownBy = relayed ? 2 : 1;
        } else {
            p.encodings[0].maxBitrate = MIC_BPS;
        }
        sender.setParameters(p).catch(() => {});
    }

    function openPc(id) {
        if (app.av.pcs.has(id)) return;
        const pc = new RTCPeerConnection({ iceServers: app.av.ice || STUN });
        const entry = { pc, polite: app.myId > id, makingOffer: false, ignoreOffer: false, relayed: false, stream: new MediaStream() };
        app.av.pcs.set(id, entry);
        pc.onicecandidate = (e) => { if (e.candidate) send({ type: 'rtc', to: id, ice: e.candidate.toJSON() }); };
        pc.onnegotiationneeded = async () => {
            try {
                entry.makingOffer = true;
                await pc.setLocalDescription();
                await send({ type: 'rtc', to: id, sdp: pc.localDescription.toJSON() });
            } catch (error) { /* retried by next negotiation */ } finally { entry.makingOffer = false; }
        };
        pc.ontrack = (e) => {
            entry.stream.addTrack(e.track);
            e.track.onended = () => {
                entry.stream.removeTrack(e.track);
                pruneStreamTracks(entry.stream);
                renderTile(id, entry.stream, app.names.get(id) || 'Friend');
            };
            pruneStreamTracks(entry.stream);
            renderTile(id, entry.stream, app.names.get(id) || 'Friend');
        };
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed') say(`Couldn’t connect faces with ${app.names.get(id) || 'a friend'}. Chat and draw still work.`);
            if (pc.connectionState === 'connected') checkRelay(id, entry);
        };
        syncTracks(entry);
        if (!entry.pc.getSenders().length) {
            pc.addTransceiver('audio', { direction: 'recvonly' });
            pc.addTransceiver('video', { direction: 'recvonly' });
        }
        renderTile(id, entry.stream, app.names.get(id) || 'Friend');
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
            entry.pc.getSenders().forEach((s) => capSender(s, entry.relayed));
        } catch (error) { /* stats unavailable */ }
    }

    async function onRtc(from, msg) {
        if (!app.names.has(from)) return;
        if (!(app.av.mic || app.av.cam) && !app.av.peers.has(from)) return;
        if (!app.av.pcs.has(from)) {
            if (!app.av.peers.has(from)) return;
            openPc(from);
        }
        const entry = app.av.pcs.get(from);
        const pc = entry.pc;
        try {
            if (msg.sdp) {
                const collision = msg.sdp.type === 'offer' && (entry.makingOffer || pc.signalingState !== 'stable');
                entry.ignoreOffer = !entry.polite && collision;
                if (entry.ignoreOffer) return;
                await pc.setRemoteDescription(msg.sdp);
                if (msg.sdp.type === 'offer') {
                    await pc.setLocalDescription();
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
        const tile = ui.tiles.querySelector(`[data-tile="${CSS.escape(id)}"]`);
        if (tile) tile.remove();
    }

    function stopAv(closeAll = false) {
        if (app.av.stream) app.av.stream.getTracks().forEach((t) => t.stop());
        app.av.stream = null;
        app.av.mic = false;
        app.av.cam = false;
        app.av.canvas = false;
        if (closeAll) Array.from(app.av.pcs.keys()).forEach(closePc);
        renderTile('me', null);
    }

    function hasLiveVideo(stream) {
        return Boolean(stream && stream.getVideoTracks().some((t) => t.readyState === 'live'));
    }

    function hasLiveAudio(stream) {
        return Boolean(stream && stream.getAudioTracks().some((t) => t.readyState === 'live'));
    }

    function pruneStreamTracks(stream) {
        if (!stream) return;
        stream.getTracks().filter((t) => t.readyState === 'ended').forEach((t) => stream.removeTrack(t));
    }

    function shouldRenderTile(id, stream) {
        if (id === 'me') return Boolean(stream);
        return hasLiveVideo(stream) || hasLiveAudio(stream);
    }

    function renderTile(id, stream, label, muted) {
        let tile = ui.tiles.querySelector(`[data-tile="${CSS.escape(id)}"]`);
        if (!shouldRenderTile(id, stream)) {
            if (tile) tile.remove();
            return;
        }
        if (!tile) {
            tile = doc.createElement('figure');
            tile.className = 'tile';
            tile.dataset.tile = id;
            const v = doc.createElement('video');
            v.autoplay = true;
            v.playsInline = true;
            v.muted = Boolean(muted);
            const cap = doc.createElement('span');
            tile.append(v, cap);
            ui.tiles.append(tile);
        }
        tile.classList.toggle('tile--canvas', id === 'me' ? app.av.canvas : app.av.canvasPeers.has(id));
        const v = tile.querySelector('video');
        if (v.srcObject !== stream) v.srcObject = stream;
        tile.querySelector('span').textContent = label || '';
    }

    ui.canvasCam.addEventListener('click', () => toggleCanvasCam());
    ui.mic.addEventListener('click', () => toggle('mic'));
    ui.cam.addEventListener('click', () => toggle('cam'));
    ui.hangup.addEventListener('click', async () => { stopAv(false); await refreshAv(); });

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
