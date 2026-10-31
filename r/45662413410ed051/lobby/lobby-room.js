/* Open-room paint, synced YouTube, and P2P cameras — reuses HangoutCore, HangoutVideo, BobRoss. */
(() => {
    'use strict';
    const H = window.HangoutCore;
    const V = window.HangoutVideo;
    const BOB = window.BobRoss;
    const STUN = [{ urls: 'stun:stun.cloudflare.com:3478' }];
    const CAM = { width: { ideal: 480, max: 640 }, height: { ideal: 360, max: 480 }, frameRate: { ideal: 15, max: 20 } };

    function attach(deps) {
        const { app, send, $, previewKey, turnUrl, isLocal, params } = deps;
        const ui = {
            stage: $('[data-act-stage]'),
            paint: $('[data-act-paint]'),
            canvas: $('[data-act-canvas]'),
            swatches: $('[data-act-swatches]'),
            clear: $('[data-act-clear]'),
            video: $('[data-act-video]'),
            yt: $('[data-act-yt]'),
            tap: $('[data-act-tap]'),
            load: $('[data-act-load]'),
            url: $('[data-act-url]'),
            bobPicks: $('[data-bob-picks]'),
            tiles: $('[data-act-tiles]')
        };
        const state = {
            ch: null, kind: null, clock: H.createClock(), room: H.emptyState(),
            myId: null, names: new Map(), camOn: false, ice: null,
            pcs: new Map(), stream: null, peers: new Set()
        };
        const player = { yt: null, ytReady: null, kind: null, key: '', applying: 0 };
        let live = null;
        let pendingPts = [];
        let flushTimer = 0;

        window.__lobbyRoom = { state, player }; // test hook

        const actSend = (obj) => send(Object.assign({ t: 'act', ch: state.ch }, obj));
        const isOp = () => {
            const c = app.chans.get(state.ch);
            return app.band || (c && c.names && c.names.some((n) => n.nick === app.me && n.prefix === '@'));
        };
        const nickOf = (id) => state.names.get(id) || 'Friend';
        const mq = (q) => { try { return Boolean(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; } };
        const phone = V.isPhoneDevice({ ua: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, coarse: mq('(pointer: coarse)'), fine: mq('(any-pointer: fine)'), cores: navigator.hardwareConcurrency });

        function teardown() {
            state.ch = null;
            state.kind = null;
            state.room = H.emptyState();
            state.names.clear();
            state.peers.clear();
            for (const id of [...state.pcs.keys()]) closePc(id);
            if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
            state.stream = null;
            state.camOn = false;
            ui.stage.hidden = true;
            ui.paint.hidden = true;
            ui.video.hidden = true;
            ui.tiles.replaceChildren();
            if (player.yt && player.yt.stopVideo) try { player.yt.stopVideo(); } catch (e) { /* */ }
            player.key = '';
        }

        function onJoin(chan, act) {
            teardown();
            if (!chan || chan.kind === 'lobby' || chan.kind === 'jam') return;
            state.ch = chan.name;
            state.kind = chan.kind;
            ui.stage.hidden = false;
            const paint = chan.kind === 'art' || chan.kind === 'bobross';
            const video = chan.kind === 'bobross' || chan.kind === 'watch';
            ui.paint.hidden = !paint;
            ui.video.hidden = !video;
            ui.load.hidden = chan.kind !== 'watch';
            ui.bobPicks.hidden = chan.kind !== 'bobross';
            if (paint) setupCanvas();
            if (video) setupVideoUi();
            if (act) ingestSnap(act);
            syncNames(chan);
            if (video && chan.kind === 'bobross' && isOp() && !state.room.video) {
                const ep = BOB.EPISODES[2];
                hostVideo({ kind: 'yt', id: ep.id }, true, 0);
            }
        }

        function ingestSnap(act) {
            if (!act) return;
            H.apply(state.room, { type: 'snapshot', state: { strokes: act.strokes || [], video: act.video } });
            redraw();
            if (state.room.video) syncToState(true);
        }

        function syncNames(chan) {
            state.names.clear();
            (chan.names || []).forEach((n) => { if (n.id) state.names.set(n.id, n.nick); });
            state.myId = (chan.names || []).find((n) => n.nick === app.me)?.id || state.myId;
            refreshAv();
        }

        function onChan(chan) {
            if (!state.ch || chan.name !== state.ch) return;
            syncNames(chan);
            const c = app.chans.get(state.ch);
            state.camOn = !!(c && c.myCam);
            refreshAv();
        }

        function onCam(ch, on) {
            if (ch !== state.ch) return;
            state.camOn = on;
            if (!on) stopCam();
            else startCam();
            refreshAv();
        }

        function onAct(m) {
            if (!m.ch || m.ch !== app.active) return;
            if (state.ch !== m.ch) state.ch = m.ch;
            if (Number.isFinite(m.ts)) state.clock.sample(m.ts);
            if (m.kind === 'stroke' && m.from !== state.myId && H.apply(state.room, { type: 'stroke', stroke: m.stroke }) === 'draw') {
                const s = state.room.strokes.find((x) => x.id === m.stroke.id);
                drawStroke(s);
            }
            if (m.kind === 'clear') {
                H.apply(state.room, { type: 'clear' });
                redraw();
            }
            if (m.kind === 'video' && m.video) {
                H.apply(state.room, { type: 'video', source: m.video.source, playing: m.video.playing, pos: m.video.pos }, { t: m.video.t });
                syncToState(true);
            }
            if (m.kind === 'rtc' && m.from) onRtc(m.from, m);
        }

        /* ---- canvas ---- */
        function setupCanvas() {
            if (!ui.swatches.dataset.ready) {
                ui.swatches.dataset.ready = '1';
                H.COLORS.slice(0, 12).forEach((color) => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'swatch';
                    b.style.background = color;
                    b.dataset.color = color;
                    b.addEventListener('click', () => { ui.swatches.dataset.color = color; });
                    ui.swatches.append(b);
                });
                ui.swatches.dataset.color = H.COLORS[2];
                ui.clear.addEventListener('click', () => { if (isOp()) actSend({ kind: 'clear' }); });
                const ctx = ui.canvas.getContext('2d');
                const pos = (e) => {
                    const r = ui.canvas.getBoundingClientRect();
                    const t = e.touches ? e.touches[0] : e;
                    return [(t.clientX - r.left) / r.width, (t.clientY - r.top) / r.height];
                };
                const down = (e) => { e.preventDefault(); live = { id: `s${Date.now().toString(36)}`, color: ui.swatches.dataset.color, size: 8, pts: [] }; pendingPts = []; addPt(...pos(e)); };
                const move = (e) => { if (!live) return; e.preventDefault(); addPt(...pos(e)); };
                const up = () => { if (!live) return; flushStroke(); live = null; };
                ui.canvas.addEventListener('mousedown', down);
                ui.canvas.addEventListener('mousemove', move);
                ui.canvas.addEventListener('mouseup', up);
                ui.canvas.addEventListener('mouseleave', up);
                ui.canvas.addEventListener('touchstart', down, { passive: false });
                ui.canvas.addEventListener('touchmove', move, { passive: false });
                ui.canvas.addEventListener('touchend', up);
            }
            redraw();
        }

        function addPt(x, y) {
            const px = Math.max(0, Math.min(1, x));
            const py = Math.max(0, Math.min(1, y));
            live.pts.push([px, py]);
            pendingPts.push([px, py]);
            drawStroke(live, Math.max(0, live.pts.length - 2));
            if (pendingPts.length >= 16) flushStroke();
            else if (!flushTimer) flushTimer = window.setTimeout(flushStroke, 80);
        }

        function flushStroke() {
            clearTimeout(flushTimer);
            flushTimer = 0;
            if (!live || !pendingPts.length) return;
            actSend({ kind: 'stroke', stroke: { id: live.id, color: live.color, size: live.size, pts: pendingPts } });
            H.apply(state.room, { type: 'stroke', stroke: { id: live.id, color: live.color, size: live.size, pts: pendingPts } });
            pendingPts = [];
        }

        function drawStroke(stroke, from = 0) {
            if (!stroke || !stroke.pts.length) return;
            const ctx = ui.canvas.getContext('2d');
            const w = ui.canvas.width;
            const h = ui.canvas.height;
            ctx.strokeStyle = stroke.color;
            ctx.lineWidth = stroke.size * (w / 1200);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            const pts = stroke.pts;
            ctx.moveTo(pts[from][0] * w, pts[from][1] * h);
            for (let i = from + 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0] * w, pts[i][1] * h);
            ctx.stroke();
        }

        function redraw() {
            const ctx = ui.canvas.getContext('2d');
            ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
            state.room.strokes.forEach((s) => drawStroke(s));
        }

        /* ---- synced video ---- */
        function setupVideoUi() {
            if (ui.bobPicks.dataset.ready) return;
            ui.bobPicks.dataset.ready = '1';
            BOB.EPISODES.slice(0, 6).forEach((ep) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'btn btn--small';
                b.textContent = `${BOB.label(ep)} · ${ep.title}`;
                b.addEventListener('click', () => hostVideo({ kind: 'yt', id: ep.id }, true, 0));
                ui.bobPicks.append(b);
            });
            ui.load.addEventListener('submit', (e) => {
                e.preventDefault();
                const id = H.parseYouTubeId(ui.url.value);
                if (!id) return;
                ui.url.value = '';
                hostVideo({ kind: 'yt', id }, true, 0);
            });
            ui.tap.addEventListener('click', () => { ui.tap.hidden = true; syncToState(true); });
        }

        function loadYouTubeApi() {
            if (player.ytReady) return player.ytReady;
            player.ytReady = new Promise((resolve) => {
                window.onYouTubeIframeAPIReady = () => resolve(window.YT);
                const s = document.createElement('script');
                s.src = 'https://www.youtube.com/iframe_api';
                document.head.append(s);
            });
            return player.ytReady;
        }

        async function ensureSource(source) {
            const key = `${source.kind}:${source.id}`;
            if (player.key === key) return;
            player.key = key;
            player.kind = 'yt';
            const YT = await loadYouTubeApi();
            if (!player.yt) {
                await new Promise((resolve) => {
                    player.yt = new YT.Player(ui.yt, {
                        videoId: source.id,
                        playerVars: { playsinline: 1, rel: 0, origin: location.origin },
                        events: { onReady: resolve, onStateChange: onYtState }
                    });
                });
            } else player.yt.cueVideoById(source.id);
        }

        function localTime() { return player.yt && player.yt.getCurrentTime ? player.yt.getCurrentTime() || 0 : 0; }
        function localPlaying() { return player.yt && player.yt.getPlayerState ? player.yt.getPlayerState() === 1 : false; }
        function hold(fn) { player.applying = Date.now() + 900; fn(); }
        function seekTo(s) { hold(() => { if (player.yt) player.yt.seekTo(s, true); }); }
        function playLocal() { hold(() => { const p = player.yt && player.yt.playVideo(); if (p && p.catch) ui.tap.hidden = false; }); }
        function pauseLocal() { hold(() => { if (player.yt) player.yt.pauseVideo(); }); }

        async function syncToState(force) {
            const v = state.room.video;
            if (!v) return;
            await ensureSource(v.source);
            const want = H.expectedPosition(v, state.clock.relayNow());
            if (force || H.needsCorrection(localTime(), want)) seekTo(want);
            if (v.playing && !localPlaying()) playLocal();
            if (!v.playing && localPlaying()) pauseLocal();
        }

        function hostVideo(source, playing, pos) {
            if (!isOp()) return;
            actSend({ kind: 'video', source, playing, pos });
            H.apply(state.room, { type: 'video', source, playing, pos }, { t: state.clock.relayNow() });
            syncToState(true);
        }

        function onYtState(ev) {
            if (!isOp() || Date.now() < player.applying || !state.room.video) return;
            if (ev.data === 1 || ev.data === 2) actSend({ kind: 'video', source: state.room.video.source, playing: localPlaying(), pos: localTime() });
        }
        setInterval(() => { if (!isOp() || !localPlaying()) syncToState(false); }, 2000);

        /* ---- P2P video (cameras only) ---- */
        async function iceServers() {
            if (state.ice) return state.ice;
            state.ice = STUN;
            const url = turnUrl;
            if (!url) return state.ice;
            try {
                const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ preview: previewKey, room: state.ch }) });
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data.iceServers)) state.ice = STUN.concat(data.iceServers);
                }
            } catch (e) { /* STUN only */ }
            return state.ice;
        }

        async function startCam() {
            await iceServers();
            if (state.stream) return;
            try {
                const got = await navigator.mediaDevices.getUserMedia({ video: CAM, audio: false });
                state.stream = got;
                for (const id of state.peers) if (!state.pcs.has(id)) openPc(id);
                layoutTiles();
            } catch (e) { /* denied */ }
        }

        function stopCam() {
            if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
            state.stream = null;
            for (const id of [...state.pcs.keys()]) closePc(id);
            layoutTiles();
        }

        function refreshAv() {
            const c = app.chans.get(state.ch);
            const ids = new Set((c && c.names || []).filter((n) => n.cam && n.id).map((n) => n.id));
            if (state.camOn && state.myId) ids.add(state.myId);
            state.peers = ids;
            if (state.camOn && state.stream) ids.forEach((id) => { if (id !== state.myId && !state.pcs.has(id)) openPc(id); });
            ids.forEach((id) => { if (id !== state.myId && !state.pcs.has(id) && state.stream) openPc(id); });
            for (const id of [...state.pcs.keys()]) if (!ids.has(id)) closePc(id);
            layoutTiles();
        }

        function openPc(id) {
            if (state.pcs.has(id) || id === state.myId) return;
            const pc = new RTCPeerConnection({ iceServers: state.ice || STUN });
            const polite = (state.myId || '') > id;
            const entry = { pc, polite, makingOffer: false, stream: new MediaStream() };
            state.pcs.set(id, entry);
            pc.onicecandidate = (e) => { if (e.candidate) actSend({ kind: 'rtc', to: id, ice: e.candidate.toJSON() }); };
            pc.ontrack = (e) => { entry.stream.addTrack(e.track); layoutTiles(); };
            pc.onnegotiationneeded = async () => {
                try {
                    entry.makingOffer = true;
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    actSend({ kind: 'rtc', to: id, sdp: pc.localDescription.toJSON() });
                } catch (e) { /* */ } finally { entry.makingOffer = false; }
            };
            if (state.stream) state.stream.getTracks().forEach((t) => pc.addTrack(t, state.stream));
            else {
                pc.addTransceiver('video', { direction: 'recvonly' });
            }
        }

        async function onRtc(from, msg) {
            if (!state.pcs.has(from)) openPc(from);
            const entry = state.pcs.get(from);
            if (!entry) return;
            const pc = entry.pc;
            try {
                if (msg.sdp) {
                    const collision = msg.sdp.type === 'offer' && (entry.makingOffer || pc.signalingState !== 'stable');
                    if (collision && !entry.polite) return;
                    await pc.setRemoteDescription(msg.sdp);
                    if (msg.sdp.type === 'offer') {
                        const answer = await pc.createAnswer();
                        await pc.setLocalDescription(answer);
                        actSend({ kind: 'rtc', to: from, sdp: pc.localDescription.toJSON() });
                    }
                } else if (msg.ice) await pc.addIceCandidate(msg.ice);
            } catch (e) { /* */ }
        }

        function closePc(id) {
            const e = state.pcs.get(id);
            if (e) e.pc.close();
            state.pcs.delete(id);
            layoutTiles();
        }

        function layoutTiles() {
            ui.tiles.replaceChildren();
            if (state.stream && state.camOn) {
                const v = document.createElement('video');
                v.autoplay = true;
                v.muted = true;
                v.playsInline = true;
                v.srcObject = state.stream;
                ui.tiles.append(v);
            }
            for (const [id, entry] of state.pcs) {
                if (!entry.stream.getVideoTracks().length) continue;
                const v = document.createElement('video');
                v.autoplay = true;
                v.playsInline = true;
                v.srcObject = entry.stream;
                v.title = nickOf(id);
                ui.tiles.append(v);
            }
        }

        return { onJoin, onChan, onCam, onAct, onLeave: teardown };
    }

    window.LobbyRoom = { attach };
})();
