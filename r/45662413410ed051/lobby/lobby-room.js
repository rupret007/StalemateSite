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
            tiles: $('[data-act-tiles]'), relayStatus: $('[data-act-relay-status]')
        };
        const state = {
            ch: null, kind: null, clock: H.createClock(), room: H.emptyState(),
            myId: null, names: new Map(), camOn: false, ice: null,
            pcs: new Map(), stream: null, peers: new Set()
        };
        const player = { yt: null, ytReady: null, kind: null, key: '', readyKey: '', loading: null, applying: 0 };
        let videoPublishTimer;
        let live = null;
        let pendingPts = [];
        let flushTimer = 0;
        let roomGeneration = 0, captureVersion = 0, turnClient = null, turnInit = null;

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
            roomGeneration += 1; captureVersion += 1;
            clearTimeout(videoPublishTimer);
            turnClient?.stop(); turnClient = null; turnInit = null; state.ice = null;
            ui.relayStatus.textContent = '';
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
            player.key = ''; player.readyKey = '';
        }

        function onJoin(chan, act) {
            teardown();
            if (!chan || !['art', 'bobross', 'watch'].includes(chan.kind)) return;
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
                ui.swatches.dataset.color = H.COLORS[2];
                const colorNames = {
                    '#f4f0e6': 'Ivory', '#171410': 'Charcoal', '#009ee8': 'Sky blue',
                    '#b5dc08': 'Lime', '#ed2765': 'Pink', '#c98a24': 'Ochre',
                    '#7a4a2a': 'Brown', '#2f7d3a': 'Forest green', '#ffffff': 'White',
                    '#0c0040': 'Indigo', '#021e44': 'Navy', '#000000': 'Black'
                };
                H.COLORS.slice(0, 12).forEach((color) => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'swatch';
                    b.style.background = color;
                    b.dataset.color = color;
                    b.setAttribute('aria-label', `${colorNames[color] || color} brush`);
                    b.setAttribute('aria-pressed', String(color === ui.swatches.dataset.color));
                    b.title = `${colorNames[color] || color} (${color})`;
                    b.addEventListener('click', () => {
                        ui.swatches.dataset.color = color;
                        ui.swatches.querySelectorAll('.swatch').forEach((swatch) => {
                            swatch.setAttribute('aria-pressed', String(swatch === b));
                        });
                    });
                    ui.swatches.append(b);
                });
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
            if (source.kind !== 'yt' || !/^[A-Za-z0-9_-]{11}$/.test(source.id || '')) return;
            const key = `${source.kind}:${source.id}`;
            if (player.key === key) return player.loading;
            const previous = player.loading;
            player.key = key;
            player.readyKey = '';
            player.kind = 'yt';
            const generation = roomGeneration;
            const loading = (async () => {
                if (previous) await previous;
                const YT = await loadYouTubeApi();
                if (generation !== roomGeneration || !state.ch || player.key !== key) return;
                if (!player.yt) {
                    await new Promise((resolve) => {
                        // Avoid the API's div constructor deriving embed metadata
                        // from this page's full URL, including any invitation.
                        const frame = document.createElement('iframe');
                        for (const attr of ui.yt.attributes) frame.setAttribute(attr.name, attr.value);
                        frame.setAttribute('frameborder', '0');
                        frame.setAttribute('allowfullscreen', '');
                        frame.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
                        frame.setAttribute('title', frame.getAttribute('title') || 'YouTube video player');
                        frame.referrerPolicy = 'strict-origin-when-cross-origin';
                        const query = new URLSearchParams({ enablejsapi: '1', origin: location.origin,
                            playsinline: '1', rel: '0', widget_referrer: location.origin });
                        frame.src = `https://www.youtube.com/embed/${encodeURIComponent(source.id)}?${query}`;
                        ui.yt.replaceWith(frame);
                        ui.yt = frame;
                        player.yt = new YT.Player(ui.yt, {
                            events: { onReady: resolve, onStateChange: onYtState }
                        });
                    });
                } else player.yt.cueVideoById(source.id);
                if (generation === roomGeneration && player.key === key) player.readyKey = key;
            })();
            player.loading = loading;
            try { await loading; }
            finally { if (player.loading === loading) player.loading = null; }
        }

        function localTime() { return player.yt && player.yt.getCurrentTime ? player.yt.getCurrentTime() || 0 : 0; }
        function localPlaying() { return player.yt && player.yt.getPlayerState ? player.yt.getPlayerState() === 1 : false; }
        function hold(fn) { player.applying = Date.now() + 900; fn(); }
        function seekTo(s) { hold(() => { if (player.yt) player.yt.seekTo(s, true); }); }
        function playLocal() { hold(() => { const p = player.yt && player.yt.playVideo(); if (p && p.catch) ui.tap.hidden = false; }); }
        function pauseLocal() { hold(() => { if (player.yt) player.yt.pauseVideo(); }); }

        async function syncToState(force) {
            const requested = state.room.video;
            if (!requested) return;
            const generation = roomGeneration;
            await ensureSource(requested.source);
            const v = state.room.video;
            if (generation !== roomGeneration || !v || player.readyKey !== `${v.source.kind}:${v.source.id}`) return;
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
            if (ev.data !== 1 && ev.data !== 2) return;
            clearTimeout(videoPublishTimer);
            const channel = state.ch;
            videoPublishTimer = setTimeout(() => {
                if (state.ch === channel && isOp() && state.room.video && Date.now() >= player.applying) {
                    actSend({ kind: 'video', source: state.room.video.source, playing: localPlaying(), pos: localTime() });
                }
            }, 100);
        }
        setInterval(() => {
            if (!isOp()) return syncToState(false);
            const v = state.room.video;
            if (!v || !player.yt || player.readyKey !== `${v.source.kind}:${v.source.id}` || Date.now() < player.applying) return;
            // YouTube does not reliably emit a state change when a paused
            // player is scrubbed. Publish the host's changed position instead
            // of correcting the host back to the previous shared position.
            const pos = localTime(), playing = localPlaying();
            if (playing !== v.playing || H.needsCorrection(pos, H.expectedPosition(v, state.clock.relayNow()))) {
                actSend({ kind: 'video', source: v.source, playing, pos });
                H.apply(state.room, { type: 'video', source: v.source, playing, pos }, { t: state.clock.relayNow() });
            }
        }, 2000);

        /* ---- P2P video (cameras only) ---- */
        async function iceServers() {
            if (!turnUrl || !state.ch) return state.ice = STUN;
            const generation = roomGeneration;
            if (!turnInit) turnInit = (async () => {
                const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`hangout-channel:${state.ch.toLowerCase()}`));
                if (generation !== roomGeneration) return null;
                const room = [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
                turnClient = window.HangoutTurn.createTurnClient({
                    url: turnUrl, preview: previewKey, room,
                    getDevice: () => { try { return localStorage.getItem('hangout-dev'); } catch (_) { return ''; } },
                    onChange: (ice) => {
                        if (generation !== roomGeneration) return;
                        state.ice = ice;
                        for (const { pc } of state.pcs.values()) {
                            try { pc.setConfiguration({ ...pc.getConfiguration(), iceServers: ice }); pc.restartIce(); } catch (_) { /* closed peer */ }
                        }
                    },
                    onStatus: (status) => {
                        if (generation !== roomGeneration) return;
                        ui.relayStatus.textContent = status === 'ready' ? 'Camera relay available for connections that need it.'
                            : 'Camera relay unavailable for now. Direct connections, chat and drawing remain available.';
                    }
                });
                return turnClient;
            })();
            const client = await turnInit;
            const ice = client ? await client.get() : STUN;
            if (generation === roomGeneration) state.ice = ice;
            return ice;
        }

        async function startCam() {
            const generation = roomGeneration, version = ++captureVersion;
            await iceServers();
            if (state.stream || !state.camOn || generation !== roomGeneration || version !== captureVersion) return;
            try {
                const got = await navigator.mediaDevices.getUserMedia({ video: CAM, audio: false });
                if (!state.camOn || generation !== roomGeneration || version !== captureVersion) {
                    got.getTracks().forEach((track) => track.stop()); return;
                }
                state.stream = got;
                for (const id of state.peers) if (!state.pcs.has(id)) openPc(id);
                layoutTiles();
            } catch (e) { /* denied */ }
        }

        function stopCam() {
            captureVersion += 1;
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
            const entry = { pc, polite, makingOffer: false, ignoreOffer: false, pendingIce: [], stream: new MediaStream() };
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
                    entry.ignoreOffer = collision && !entry.polite;
                    if (entry.ignoreOffer) return;
                    await pc.setRemoteDescription(msg.sdp);
                    for (const ice of entry.pendingIce.splice(0)) {
                        try { await pc.addIceCandidate(ice); } catch (_) { /* stale negotiation */ }
                    }
                    if (msg.sdp.type === 'offer') {
                        const answer = await pc.createAnswer();
                        await pc.setLocalDescription(answer);
                        actSend({ kind: 'rtc', to: from, sdp: pc.localDescription.toJSON() });
                    }
                } else if (msg.ice) {
                    if (!pc.remoteDescription) { if (entry.pendingIce.length < 64) entry.pendingIce.push(msg.ice); }
                    else await pc.addIceCandidate(msg.ice);
                }
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
