/* Open-room paint, synced YouTube, and P2P cameras — reuses HangoutCore, HangoutVideo, BobRoss. */
(() => {
    'use strict';
    const H = window.HangoutCore;
    const V = window.HangoutVideo;
    const BOB = window.BobRoss;
    const STUN = [{ urls: 'stun:stun.cloudflare.com:3478' }];
    const CAM = { width: { ideal: 480, max: 640 }, height: { ideal: 360, max: 480 }, frameRate: { ideal: 15, max: 20 } };

    function attach(deps) {
        const { app, send: rawSend, $, previewKey, turnUrl, isLocal, params } = deps;
        const ui = {
            stage: $('[data-act-stage]'),
            paint: $('[data-act-paint]'),
            canvas: $('[data-act-canvas]'),
            swatches: $('[data-act-swatches]'),
            clear: $('[data-act-clear]'),
            video: $('[data-act-video]'),
            yt: $('[data-act-yt]'),
            tap: $('[data-act-tap]'),
            videoStatus: $('[data-act-video-status]'),
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
        const player = { yt: null, kind: null, key: '', readyKey: '', failedKey: '', loading: null, applying: 0, autoplayBlocked: false, seenPlaying: false, playPending: false };
        const youtube = window.HangoutYouTube.create({
            getElement: () => ui.yt, setElement: (element) => { ui.yt = element; },
            onStateChange: onYtState, onAutoplayBlocked: onYtAutoplayBlocked,
            onError: () => videoFailure(player.key)
        });
        let videoPublishTimer;
        let live = null;
        let pendingPts = [];
        let flushTimer = 0;
        let roomGeneration = 0, captureVersion = 0, turnClient = null, turnInit = null;
        let cameraFailureNotice = '';
        // The server keeps one activity allowance (burst 24, refill 10/s).
        // Drawing and camera signaling share this smaller client allowance so
        // an ICE burst queues rather than silently consuming an SDP's budget.
        const activity = { tokens: 8, at: Date.now(), queue: [], bytes: 0, timer: 0 };
        const ACT_QUEUE_FRAMES = 128, ACT_QUEUE_BYTES = 256 * 1024;

        window.__lobbyRoom = { state, player }; // test hook

        const actSend = (obj, onSent) => send(Object.assign({ t: 'act', ch: state.ch }, obj), null, onSent);
        const isOp = () => {
            const c = app.chans.get(state.ch);
            return app.band || (c && c.names && c.names.some((n) => n.nick === app.me && n.prefix === '@'));
        };
        const nickOf = (id) => state.names.get(id) || 'Friend';
        const mq = (q) => { try { return Boolean(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; } };
        const phone = V.isPhoneDevice({ ua: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, coarse: mq('(pointer: coarse)'), fine: mq('(any-pointer: fine)'), cores: navigator.hardwareConcurrency });

        function activityNotice(text) { ui.relayStatus.textContent = text; }
        function descriptionKey(description) {
            if (!description || typeof description.sdp !== 'string') return null;
            const lines = description.sdp.split(/\r?\n/).filter(Boolean), origin = lines.filter(line => /^o=/.test(line));
            if (!origin.length) return `${description.type}\n${lines.filter(line => !/^a=(?:candidate:|end-of-candidates$)/.test(line)).join('\n')}`;
            // API epochs bind every local-description write and incoming-offer
            // rollback. This additional identity check preserves origin, ICE,
            // media/direction and rejected-port identity without mistaking
            // native gathered transport addresses/ports for a new negotiation.
            const media = lines.filter(line => /^m=/.test(line)).map(line => {
                const [kind, port, ...format] = line.slice(2).trim().split(/\s+/);
                return [kind, port.split('/')[0] === '0' ? 'rejected' : 'active', port.includes('/') ? port.slice(port.indexOf('/')) : '', ...format];
            });
            return JSON.stringify([description.type, origin, media,
                lines.filter(line => /^a=(?:ice-(?:ufrag|pwd):|mid:|group:|sendrecv$|sendonly$|recvonly$|inactive$)/.test(line))]);
        }
        function iceGeneration(description, candidate, ufrag) {
            if (!description || typeof description.sdp !== 'string') return null;
            const session = [], media = []; let lines = session;
            for (const line of description.sdp.split(/\r?\n/).filter(Boolean)) {
                if (line.startsWith('m=')) { lines = []; media.push(lines); } lines.push(line);
            }
            // Retain the description identity fallback for legacy descriptions
            // without media sections. Native media SDP uses the exact section
            // named by this candidate, never a union of unrelated ICE tuples.
            if (!media.length) {
                if (ufrag && !session.includes(`a=ice-ufrag:${ufrag}`)) return null;
                return descriptionKey(description);
            }
            const hasMid = candidate?.sdpMid !== undefined && candidate.sdpMid !== null;
            const hasIndex = candidate?.sdpMLineIndex !== undefined && candidate.sdpMLineIndex !== null;
            if ((!hasMid && !hasIndex) || (hasMid && typeof candidate.sdpMid !== 'string') ||
                (hasIndex && (!Number.isInteger(candidate.sdpMLineIndex) || candidate.sdpMLineIndex < 0))) return null;
            const matching = hasMid ? media.filter(section => section.includes(`a=mid:${candidate.sdpMid}`)) : [];
            const indexed = hasIndex ? media[candidate.sdpMLineIndex] : null;
            const selected = hasMid ? matching.length === 1 ? matching[0] : null : indexed;
            if (!selected || (hasIndex && indexed !== selected)) return null;
            const attribute = name => {
                const prefix = `a=ice-${name}:`;
                return (selected.find(line => line.startsWith(prefix)) || session.find(line => line.startsWith(prefix)) || '').slice(prefix.length);
            };
            const fragment = attribute('ufrag'), password = attribute('pwd');
            if (!fragment || !password || (ufrag && ufrag !== fragment)) return null;
            return JSON.stringify([fragment, password]);
        }
        function currentActivity(item) {
            if (item.generation !== roomGeneration || item.channel !== state.ch || state.ch !== app.active || !state.names.has(state.myId)) return false;
            if (item.kind === 'clear' || item.kind === 'video') return isOp();
            if (item.kind !== 'rtc') return paintActive();
            if (!item.entry?.current()) return false;
            const current = item.entry.pc.localDescription;
            if (item.sdp) return item.epoch === item.entry.descriptionEpoch && descriptionKey(item.sdp) !== null && descriptionKey(current) === descriptionKey(item.sdp);
            return !!item.iceGeneration && iceGeneration(current, item.iceSelector, item.ufrag) === item.iceGeneration;
        }
        function removeActivity(index) {
            const [item] = activity.queue.splice(index, 1); activity.bytes -= item.bytes; return item;
        }
        function purgeActivity(entry) {
            for (let index = activity.queue.length - 1; index >= 0; index--) {
                if (entry ? activity.queue[index].entry === entry : !currentActivity(activity.queue[index])) removeActivity(index);
            }
            if (!activity.queue.length) { clearTimeout(activity.timer); activity.timer = 0; }
        }
        function flushActivity() {
            clearTimeout(activity.timer); activity.timer = 0; purgeActivity();
            const at = Date.now();
            activity.tokens = Math.min(8, activity.tokens + Math.max(0, at - activity.at) * 8 / 1000); activity.at = at;
            while (activity.queue.length && activity.tokens >= 1) {
                const item = removeActivity(0); activity.tokens -= 1;
                let sent = false;
                try { sent = rawSend(JSON.parse(item.raw)) !== false; } catch (_) { /* connection ended */ }
                if (!sent) {
                    item.failed = true;
                    activityNotice('Activity connection interrupted. Rejoin this room to refresh shared activity.');
                    const pending = activity.queue.splice(0); activity.bytes = 0;
                    if (item.entry) closePc(item.to);
                    for (const queued of pending) { queued.failed = true; if (queued.entry) closePc(queued.to); }
                    cancelStroke(); redraw(); break;
                }
                item.onSent?.();
            }
            if (activity.queue.length) activity.timer = window.setTimeout(flushActivity, 125);
        }
        function send(frame, entry, onSent) {
            if (frame.t !== 'act') return rawSend(frame) !== false;
            const raw = JSON.stringify(frame), bytes = new Blob([raw]).size;
            const ufrag = frame.ice?.usernameFragment || /(?:^|\s)ufrag\s+(\S+)/.exec(frame.ice?.candidate || '')?.[1] || '';
            const item = { raw, bytes, channel: frame.ch, generation: roomGeneration, kind: frame.kind,
                entry, to: frame.to, sdp: frame.sdp, ufrag, onSent,
                iceSelector: frame.ice ? { sdpMid: frame.ice.sdpMid, sdpMLineIndex: frame.ice.sdpMLineIndex } : null,
                epoch: entry?.descriptionEpoch, iceGeneration: frame.ice ? iceGeneration(entry?.pc.localDescription, frame.ice, ufrag) : null,
                priority: frame.kind === 'rtc' && !!frame.sdp };
            purgeActivity();
            if (!currentActivity(item)) return false;
            // Consecutive unsent chunks of one brush stroke can share a frame.
            // Every point stays in order, and no clear/video/other stroke is
            // crossed. This keeps ordinary 80ms brush sampling responsive while
            // all activity stays below the shared server allowance.
            const tail = activity.queue.at(-1);
            if (frame.kind === 'stroke' && tail?.kind === 'stroke' && tail.channel === item.channel && tail.generation === item.generation) {
                const previous = JSON.parse(tail.raw), a = previous.stroke, b = frame.stroke;
                if (a.id === b.id && a.color === b.color && a.size === b.size && a.pts.length + b.pts.length <= 400) {
                    previous.stroke.pts = a.pts.concat(b.pts);
                    const combined = JSON.stringify(previous), combinedBytes = new Blob([combined]).size;
                    if (combinedBytes <= 16384 && activity.bytes - tail.bytes + combinedBytes <= ACT_QUEUE_BYTES) {
                        activity.bytes += combinedBytes - tail.bytes; tail.raw = combined; tail.bytes = combinedBytes;
                        flushActivity(); return !tail.failed;
                    }
                }
            }
            if (bytes > 16384 || activity.queue.length >= ACT_QUEUE_FRAMES || activity.bytes + bytes > ACT_QUEUE_BYTES) {
                activityNotice('Activity is busy. This action was not queued; wait a moment before trying again.');
                if (entry) closePc(frame.to);
                return false;
            }
            // SDP can precede queued candidates; the receiver already buffers
            // early ICE. Preserve SDP order and the order of all paint/clear/
            // video operations. Never shed an accepted drawing to make space.
            const before = item.priority ? activity.queue.findIndex(queued => !queued.priority) : -1;
            if (before < 0) activity.queue.push(item); else activity.queue.splice(before, 0, item);
            activity.bytes += bytes; flushActivity();
            return !item.failed; // Queued locally, not acknowledged by the server.
        }

        function teardown() {
            roomGeneration += 1; captureVersion += 1;
            clearTimeout(activity.timer); activity.timer = 0; activity.queue = []; activity.bytes = 0;
            cancelStroke();
            clearTimeout(videoPublishTimer);
            turnClient?.stop(); turnClient = null; turnInit = null; state.ice = null;
            ui.relayStatus.textContent = '';
            cameraFailureNotice = '';
            state.ch = null;
            state.kind = null;
            state.room = H.emptyState();
            state.names.clear();
            state.peers.clear();
            for (const id of [...state.pcs.keys()]) closePc(id);
            if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
            state.stream = null;
            state.camOn = false;
            resetCameraPresentation();
            ui.stage.hidden = true;
            ui.paint.hidden = true;
            ui.video.hidden = true;
            youtube.cancel(); player.yt = null;
            player.key = ''; player.readyKey = ''; player.failedKey = ''; player.loading = null; player.autoplayBlocked = false;
            player.seenPlaying = false; player.playPending = false;
            ui.videoStatus.hidden = true; ui.videoStatus.textContent = '';
            ui.tap.hidden = true;
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
            // A late frame cannot re-establish a room which was left, revoked
            // or torn down while navigation/session state was changing.
            if (!m.ch || m.ch !== app.active || m.ch !== state.ch) return;
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
        const paintActive = () => !!state.ch && state.ch === app.active && ['art', 'bobross'].includes(state.kind);
        const currentStroke = () => live && paintActive() && live.channel === state.ch && live.generation === roomGeneration;
        function cancelStroke() {
            clearTimeout(flushTimer); flushTimer = 0; live = null; pendingPts = [];
        }

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
                const down = (e) => {
                    if (!paintActive() || e.type === 'mousedown' && e.button !== 0) return;
                    e.preventDefault(); cancelStroke();
                    live = { id: `s${Date.now().toString(36)}`, color: ui.swatches.dataset.color, size: 8, pts: [], channel: state.ch, generation: roomGeneration };
                    addPt(...pos(e));
                };
                const move = (e) => { if (!currentStroke()) { cancelStroke(); return; } e.preventDefault(); addPt(...pos(e)); };
                const up = () => { if (!live) return; flushStroke(); live = null; };
                ui.canvas.addEventListener('mousedown', down);
                ui.canvas.addEventListener('mousemove', move);
                ui.canvas.addEventListener('mouseup', up);
                ui.canvas.addEventListener('mouseleave', up);
                ui.canvas.addEventListener('touchstart', down, { passive: false });
                ui.canvas.addEventListener('touchmove', move, { passive: false });
                ui.canvas.addEventListener('touchend', up);
                ui.canvas.addEventListener('touchcancel', () => { cancelStroke(); redraw(); });
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
            else if (!flushTimer) {
                const stroke = live;
                flushTimer = window.setTimeout(() => { if (live === stroke) flushStroke(); }, 80);
            }
        }

        function flushStroke() {
            clearTimeout(flushTimer);
            flushTimer = 0;
            if (!currentStroke()) { cancelStroke(); return; }
            if (!pendingPts.length) return;
            if (!send({ t: 'act', ch: live.channel, kind: 'stroke', stroke: { id: live.id, color: live.color, size: live.size, pts: pendingPts } })) {
                cancelStroke(); redraw(); return;
            }
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
            ui.tap.addEventListener('click', () => syncToState(true, true));
        }

        function videoFailure(key) {
            if (!state.ch || player.key !== key) return;
            player.yt = null; player.readyKey = ''; player.failedKey = key; player.autoplayBlocked = false;
            player.seenPlaying = false; player.playPending = false;
            ui.videoStatus.textContent = 'YouTube couldn’t load. Retry video when you’re ready.';
            ui.videoStatus.hidden = false;
            ui.tap.textContent = 'Retry video'; ui.tap.hidden = false;
        }

        async function ensureSource(source, retry = false) {
            if (!state.ch || source.kind !== 'yt' || !/^[A-Za-z0-9_-]{11}$/.test(source.id || '')) return false;
            const key = `${source.kind}:${source.id}`;
            if (player.key === key) {
                if (player.failedKey === key && !retry) return false;
                if (player.loading) return player.loading;
                if (player.readyKey === key) return true;
            }
            player.key = key;
            player.readyKey = ''; player.failedKey = '';
            player.autoplayBlocked = false;
            player.seenPlaying = false; player.playPending = false;
            ui.tap.hidden = true; ui.tap.textContent = 'Tap to play';
            ui.videoStatus.hidden = true; ui.videoStatus.textContent = '';
            player.kind = 'yt';
            player.yt = null;
            ui.videoStatus.textContent = 'Loading YouTube…'; ui.videoStatus.hidden = false;
            const generation = roomGeneration;
            const loading = (async () => {
                try {
                    const instance = await youtube.select(source.id);
                    if (!instance || generation !== roomGeneration || !state.ch || player.key !== key) return false;
                    player.yt = instance; player.readyKey = key;
                    ui.videoStatus.hidden = true; ui.videoStatus.textContent = '';
                    return true;
                } catch (_) {
                    if (generation === roomGeneration) videoFailure(key);
                    return false;
                }
            })();
            player.loading = loading;
            try { return await loading; }
            finally { if (player.loading === loading) player.loading = null; }
        }

        function localTime() { return player.yt && player.yt.getCurrentTime ? player.yt.getCurrentTime() || 0 : 0; }
        function localPlaying() { return player.yt && player.yt.getPlayerState ? player.yt.getPlayerState() === 1 : false; }
        function hold(fn) { player.applying = Date.now() + 900; fn(); }
        function seekTo(s) { hold(() => { if (player.yt) player.yt.seekTo(s, true); }); }
        function playLocal() { hold(() => { if (player.yt) { player.playPending = true; player.yt.playVideo(); } }); }
        function pauseLocal() { hold(() => { player.playPending = false; if (player.yt) player.yt.pauseVideo(); }); }

        async function syncToState(force, retry = false) {
            const requested = state.room.video;
            if (!requested) return;
            const generation = roomGeneration;
            if (!await ensureSource(requested.source, retry)) return;
            const v = state.room.video;
            if (generation !== roomGeneration || v !== requested || player.readyKey !== `${v.source.kind}:${v.source.id}`) return;
            if (!v.playing) { player.autoplayBlocked = false; ui.tap.hidden = true; }
            else if (player.autoplayBlocked && !force) return;
            const want = H.expectedPosition(v, state.clock.relayNow());
            if (force || H.needsCorrection(localTime(), want)) seekTo(want);
            if (v.playing && !localPlaying()) playLocal();
            if (!v.playing && localPlaying()) pauseLocal();
        }

        function hostVideo(source, playing, pos) {
            if (!isOp()) return;
            actSend({ kind: 'video', source, playing, pos }, () => {
                H.apply(state.room, { type: 'video', source, playing, pos }, { t: state.clock.relayNow() });
                syncToState(true, true);
            });
        }

        function onYtAutoplayBlocked() {
            const v = state.room.video;
            if (!state.ch || !player.playPending || localPlaying() || !v?.playing || v.source.kind !== 'yt' || player.readyKey !== `${v.source.kind}:${v.source.id}`) return;
            // Policy denial is local, not a request to pause everyone else.
            player.autoplayBlocked = true;
            ui.tap.hidden = false;
        }
        function onYtState(ev) {
            if (!state.ch || ev.target !== player.yt || ev.data !== player.yt?.getPlayerState()) return;
            if (ev.data === 1) { player.seenPlaying = true; player.playPending = false; player.autoplayBlocked = false; ui.tap.hidden = true; }
            if (!isOp() || player.autoplayBlocked || !state.room.video || (!player.seenPlaying && state.room.video.playing)
                || player.readyKey !== `${state.room.video.source.kind}:${state.room.video.source.id}`) return;
            if (ev.data !== 1 && ev.data !== 2) return;
            clearTimeout(videoPublishTimer);
            const channel = state.ch, generation = roomGeneration, instance = player.yt, key = player.readyKey;
            videoPublishTimer = setTimeout(() => {
                if (generation === roomGeneration && state.ch === channel && isOp() && !player.autoplayBlocked && state.room.video
                    && player.yt === instance && player.readyKey === key && key === `${state.room.video.source.kind}:${state.room.video.source.id}`) {
                    const v = state.room.video, playing = localPlaying(), pos = localTime();
                    // Suppress the echo of our own sync, not a subsequent
                    // opposite host control within the same 900ms window.
                    if (Date.now() < player.applying && playing === v.playing && Math.abs(pos - H.expectedPosition(v, state.clock.relayNow())) < 2) return;
                    actSend({ kind: 'video', source: v.source, playing, pos });
                }
            }, 100);
        }
        setInterval(() => {
            if (!isOp()) return syncToState(false);
            const v = state.room.video;
            if (!v || !player.yt || (!player.seenPlaying && v.playing) || player.autoplayBlocked || player.readyKey !== `${v.source.kind}:${v.source.id}` || Date.now() < player.applying) return;
            // YouTube does not reliably emit a state change when a paused
            // player is scrubbed. Publish the host's changed position instead
            // of correcting the host back to the previous shared position.
            const pos = localTime(), playing = localPlaying();
            if (playing !== v.playing || H.needsCorrection(pos, H.expectedPosition(v, state.clock.relayNow()))) {
                actSend({ kind: 'video', source: v.source, playing, pos }, () =>
                    H.apply(state.room, { type: 'video', source: v.source, playing, pos }, { t: state.clock.relayNow() }));
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
            try {
                await iceServers();
                if (state.stream || !state.camOn || generation !== roomGeneration || version !== captureVersion) return;
                if (cameraFailureNotice && ui.relayStatus.textContent === cameraFailureNotice) activityNotice('');
                cameraFailureNotice = '';
                const got = await navigator.mediaDevices.getUserMedia({ video: CAM, audio: false });
                if (!state.camOn || generation !== roomGeneration || version !== captureVersion) {
                    got.getTracks().forEach((track) => track.stop()); return;
                }
                state.stream = got;
                // Signaling can create a receive-only pair while the browser
                // permission/capture promise is pending. Add our opted-in
                // tracks to those current pairs too, without another capture.
                for (const entry of state.pcs.values()) entry.attachLocalTracks();
                for (const id of state.peers) if (!state.pcs.has(id)) openPc(id);
                layoutTiles();
            } catch {
                // An old permission result must not turn off a newer camera or
                // change another room. Current failure always retires capture
                // locally, even when its off notification cannot be delivered.
                if (!state.camOn || generation !== roomGeneration || version !== captureVersion || state.ch !== app.active) return;
                state.camOn = false;
                const channel = state.ch, c = app.chans.get(channel);
                if (c) c.myCam = false;
                stopCam();
                try {
                    if (typeof deps.onCameraFailure === 'function') deps.onCameraFailure(channel);
                    else send({ t: 'cam', ch: channel, on: false });
                } catch { /* Capture is already off; no automatic retry. */ }
                cameraFailureNotice = 'Camera could not start. It is off in this tab. Check camera permissions or device availability, then choose the camera button to try again.';
                activityNotice(cameraFailureNotice);
            }
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
            const ids = new Set((c && c.names || []).filter((n) => n.cam && n.id && mediaPeerAllowed(n.id)).map((n) => n.id));
            if (state.camOn && state.myId) ids.add(state.myId);
            state.peers = ids;
            if (state.camOn && state.stream) ids.forEach((id) => { if (id !== state.myId && !state.pcs.has(id)) openPc(id); });
            ids.forEach((id) => { if (id !== state.myId && !state.pcs.has(id) && state.stream) openPc(id); });
            // An existing receiver need not publish their own camera. Preserve
            // that current allowed pair while our opted-in capture is active.
            for (const [id, entry] of [...state.pcs]) if (!entry.current() || !ids.has(id) && !(state.camOn && state.stream)) closePc(id);
            layoutTiles();
        }

        function mediaPeerAllowed(id) {
            const c = app.chans.get(state.ch);
            return state.names.has(id) && !(Array.isArray(c?.mediaBlocked) && c.mediaBlocked.includes(id));
        }

        function openPc(id, { passive = false } = {}) {
            if (!state.ch || state.ch !== app.active || state.pcs.has(id) || id === state.myId || !mediaPeerAllowed(id)) return;
            const channel = state.ch, generation = roomGeneration;
            const pc = new RTCPeerConnection({ iceServers: state.ice || STUN });
            const polite = (state.myId || '') > id;
            const entry = { pc, polite, remoteReady: !passive, makingOffer: false, offerNeeded: false, remoteOfferJobs: 0, localOperation: null, settingRemoteAnswer: false, ignoreOffer: false, descriptionEpoch: 0, pendingIce: [], stream: new MediaStream() };
            entry.current = () => generation === roomGeneration && state.ch === channel && app.active === channel && state.pcs.get(id) === entry && mediaPeerAllowed(id);
            entry.attachLocalTracks = () => {
                if (!entry.current() || !entry.remoteReady || !state.stream) return;
                for (const track of state.stream.getTracks()) if (!pc.getSenders().some(sender => sender.track === track)) pc.addTrack(track, state.stream);
            };
            entry.writeLocalDescription = async description => {
                // Publish ownership before native invocation: native wrappers can
                // synchronously deliver a peer offer before returning a promise.
                while (entry.localOperation) {
                    await entry.localOperation.done;
                    if (!entry.current()) return;
                }
                if (!entry.current()) return;
                if (description?.type === 'rollback' && (pc.signalingState !== 'have-local-offer' || entry.settingRemoteAnswer)) return;
                let finish;
                const operation = { done: new Promise(resolve => { finish = resolve; }), finish: () => finish() };
                entry.localOperation = operation;
                try {
                    await (description === undefined ? pc.setLocalDescription() : pc.setLocalDescription(description));
                } finally {
                    if (entry.localOperation === operation) entry.localOperation = null;
                    operation.finish();
                }
            };
            entry.signal = message => {
                if (entry.current()) send({ t: 'act', ch: channel, kind: 'rtc', to: id, ...message }, entry,
                    message.sdp?.type === 'answer' ? () => entry.pumpOffer() : null);
            };
            state.pcs.set(id, entry);
            pc.onicecandidate = (e) => { if (entry.current() && e.candidate) entry.signal({ ice: e.candidate.toJSON() }); };
            pc.ontrack = (e) => { if (!entry.current()) { e.track.stop(); return; } entry.stream.addTrack(e.track); layoutTiles(); };
            entry.pumpOffer = async () => {
                // Accepted remote offers own SRD through answer publication.
                // A paced answer must get its raw send attempt before another
                // local description invalidates its queued SDP identity/epoch.
                if (!entry.current() || !entry.remoteReady || !entry.offerNeeded || entry.makingOffer || entry.remoteOfferJobs || pc.signalingState !== 'stable'
                    || activity.queue.some(item => item.entry === entry && item.sdp?.type === 'answer')) return;
                entry.offerNeeded = false;
                entry.makingOffer = true;
                let failed = false;
                try {
                    const epoch = ++entry.descriptionEpoch;
                    // Let the native operation choose its current offer/answer
                    // atomically; a separately awaited offer can already be stale.
                    await entry.writeLocalDescription();
                    if (entry.current() && entry.descriptionEpoch === epoch) entry.signal({ sdp: pc.localDescription.toJSON() });
                } catch (e) { failed = true; entry.offerNeeded = entry.current(); }
                finally {
                    entry.makingOffer = false;
                    // Keep failure debt for a later genuine event, never a
                    // same-failure retry loop. New work during await is latched.
                    if (!failed) entry.pumpOffer();
                }
            };
            pc.onnegotiationneeded = () => {
                if (!entry.current()) return;
                entry.offerNeeded = true;
                return entry.pumpOffer();
            };
            entry.attachLocalTracks();
            // An incoming offer creates its receiver through native SRD. An
            // empty PC created by early ICE must not invent a competing offer
            // while the visitor's opted-in camera capture is still pending.
            return entry;
        }

        async function onRtc(from, msg) {
            if (!mediaPeerAllowed(from)) return;
            const operationChannel = state.ch, operationGeneration = roomGeneration;
            if (!state.pcs.has(from)) openPc(from, { passive: true });
            let entry = state.pcs.get(from);
            if (!entry?.current()) return;
            let pc = entry.pc;
            try {
                if (msg.sdp) {
                    if (msg.sdp.type === 'answer' && !entry.remoteReady) { closePc(from, entry); return; }
                    const readyForOffer = !entry.makingOffer && (pc.signalingState === 'stable' || entry.settingRemoteAnswer);
                    const collision = msg.sdp.type === 'offer' && !readyForOffer;
                    entry.ignoreOffer = collision && !entry.polite;
                    if (entry.ignoreOffer) return;
                    const offer = msg.sdp.type === 'offer';
                    if (offer) { entry.descriptionEpoch += 1; entry.remoteOfferJobs += 1; }
                    let offerOwner = offer ? entry : null;
                    const answer = msg.sdp.type === 'answer';
                    let completed = false;
                    try {
                        if (offer) {
                            const localOperation = entry.localOperation;
                            if (localOperation) await localOperation.done;
                            if (!entry.current()) return;
                            if (pc.signalingState === 'have-local-offer' && !entry.settingRemoteAnswer) {
                                if (collision && entry.polite && !pc.currentRemoteDescription && !pc.remoteDescription) {
                                    // Initial polite glare has no negotiated remote
                                    // transport to preserve. Retire only this pair;
                                    // its fresh answerer waits for SRD before tracks.
                                    const retired = entry, earlyIce = retired.pendingIce.slice(0, 64);
                                    if (!closePc(from, retired)) return;
                                    if (operationGeneration !== roomGeneration || operationChannel !== state.ch || app.active !== operationChannel || !mediaPeerAllowed(from)) return;
                                    const fresh = openPc(from, { passive: true });
                                    if (!fresh?.current()) { if (fresh) closePc(from, fresh); return; }
                                    // Transfer this handler's counter only after
                                    // allocation succeeds; old callbacks own theirs.
                                    offerOwner.remoteOfferJobs -= 1;
                                    entry = fresh; pc = fresh.pc; offerOwner = fresh;
                                    entry.remoteOfferJobs += 1; entry.descriptionEpoch += 1;
                                    entry.pendingIce.push(...earlyIce);
                                } else {
                                    await entry.writeLocalDescription({ type: 'rollback' });
                                    if (!entry.current()) return;
                                }
                            }
                        }
                        if (answer) entry.settingRemoteAnswer = true;
                        try { await pc.setRemoteDescription(msg.sdp); }
                        finally { if (answer) entry.settingRemoteAnswer = false; }
                        if (!entry.current()) return;
                        entry.remoteReady = true; entry.attachLocalTracks();
                        for (const ice of entry.pendingIce.splice(0)) {
                            try { await pc.addIceCandidate(ice); } catch (_) { /* stale negotiation */ }
                            if (!entry.current()) return;
                        }
                        if (offer) {
                            // Track changes already pending are covered by this
                            // native answer. Later events retain separate debt.
                            entry.offerNeeded = false;
                            const epoch = ++entry.descriptionEpoch;
                            await entry.writeLocalDescription();
                            if (entry.current() && entry.descriptionEpoch === epoch) entry.signal({ sdp: pc.localDescription.toJSON() });
                        }
                        completed = true;
                    } finally {
                        if (offerOwner) offerOwner.remoteOfferJobs -= 1;
                        if (completed) entry.pumpOffer();
                    }
                } else if (msg.ice) {
                    if (!pc.remoteDescription) { if (entry.pendingIce.length < 64) entry.pendingIce.push(msg.ice); }
                    else await pc.addIceCandidate(msg.ice);
                }
            } catch (e) { /* */ }
        }

        function closePc(id, expected = null) {
            const e = state.pcs.get(id);
            if (expected && e !== expected) return false;
            state.pcs.delete(id);
            if (e) {
                e.offerNeeded = false;
                const localOperation = e.localOperation; e.localOperation = null;
                localOperation?.finish();
                purgeActivity(e);
                e.pc.onicecandidate = null; e.pc.ontrack = null; e.pc.onnegotiationneeded = null;
                e.pendingIce.length = 0;
                e.stream.getTracks().forEach(track => track.stop());
                e.pc.close();
            }
            layoutTiles();
            return true;
        }

        function retireCameraFocus(activity) {
            const candidates = [$('[data-palette-open]'), $('[data-text]'), document.querySelector('.phonetabs [aria-current="true"]'), activity?.querySelector('summary')];
            const fallback = candidates.find(element => element && !element.disabled && !element.closest('[hidden], [inert]')
                && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
            fallback?.focus({ preventScroll: true });
        }

        function resetCameraPresentation() {
            const activity = ui.tiles.closest('[data-activity]');
            const strip = ui.tiles.closest('[data-act-camera-strip]');
            const wasFocused = ui.tiles.contains(document.activeElement);
            const view = layoutTiles.view;
            if (view) {
                for (const row of view.rows.values()) { row.video.srcObject = null; row.figure.remove(); }
                view.rows.clear(); view.scrollLeft = 0;
            }
            ui.tiles.replaceChildren(); ui.tiles.scrollLeft = 0; ui.tiles.tabIndex = -1;
            ui.tiles.setAttribute('aria-describedby', 'lobby-camera-count');
            if (strip) {
                strip.hidden = true;
                const count = strip.querySelector('[data-act-camera-count]'); if (count) count.textContent = 'Cameras (0)';
                const hint = strip.querySelector('[data-act-camera-hint]'); if (hint) hint.hidden = true;
                const help = strip.querySelector('#lobby-camera-scroll-help'); if (help) help.hidden = true;
            }
            const summary = $('[data-act-camera-summary]'); if (summary) { summary.hidden = true; summary.textContent = ''; }
            if (activity) activity.scrollTop = 0;
            if (wasFocused) retireCameraFocus(activity);
        }

        function layoutTiles() {
            const strip = ui.tiles.closest('[data-act-camera-strip]');
            const activity = ui.tiles.closest('[data-activity]');
            const countLabel = strip?.querySelector('[data-act-camera-count]');
            const hint = strip?.querySelector('[data-act-camera-hint]');
            const help = strip?.querySelector('#lobby-camera-scroll-help');
            const summaryCount = $('[data-act-camera-summary]');
            const view = layoutTiles.view ||= { rows: new Map(), nextLabel: 0, scrollLeft: 0 };
            const wasFocused = ui.tiles.contains(document.activeElement);
            if (ui.tiles.clientWidth) view.scrollLeft = ui.tiles.scrollLeft;
            const activityTop = activity?.scrollTop || 0;
            const metrics = () => {
                const measurable = ui.tiles.clientWidth > 0;
                const max = Math.max(0, ui.tiles.scrollWidth - ui.tiles.clientWidth);
                const overflowing = measurable && max > 1;
                ui.tiles.tabIndex = overflowing ? 0 : -1;
                if (hint) hint.hidden = !overflowing;
                if (help) help.hidden = !overflowing;
                ui.tiles.setAttribute('aria-describedby', overflowing ? 'lobby-camera-count lobby-camera-scroll-help' : 'lobby-camera-count');
                if (measurable) {
                    ui.tiles.scrollLeft = Math.min(view.scrollLeft, max);
                    view.scrollLeft = ui.tiles.scrollLeft;
                }
            };
            if (!view.ready) {
                view.ready = true;
                ui.tiles.addEventListener('scroll', () => { if (ui.tiles.clientWidth) view.scrollLeft = ui.tiles.scrollLeft; }, { passive: true });
                ui.tiles.addEventListener('keydown', event => {
                    if (event.target !== ui.tiles || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
                    const max = Math.max(0, ui.tiles.scrollWidth - ui.tiles.clientWidth);
                    if (max <= 1 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    const step = Math.max(1, ui.tiles.clientWidth - 32);
                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? max : ui.tiles.scrollLeft + (event.key === 'ArrowRight' ? step : -step);
                    event.preventDefault(); ui.tiles.scrollLeft = Math.max(0, Math.min(next, max)); view.scrollLeft = ui.tiles.scrollLeft;
                });
                activity?.addEventListener('toggle', metrics);
                window.addEventListener('resize', metrics);
                if (window.ResizeObserver) { view.observer = new window.ResizeObserver(metrics); view.observer.observe(ui.tiles); }
            }
            const cameras = [];
            if (state.stream && state.camOn) cameras.push({ key: 'self', stream: state.stream, self: true, name: 'You · preview' });
            for (const [id, entry] of state.pcs) {
                if (state.peers.has(id) && entry.stream.getVideoTracks().length) cameras.push({ key: id, stream: entry.stream, self: false, name: nickOf(id) });
            }
            const wanted = new Set(cameras.map(camera => camera.key));
            for (const [key, row] of view.rows) if (!wanted.has(key)) {
                row.video.srcObject = null; row.figure.remove(); view.rows.delete(key);
            }
            cameras.forEach((camera, index) => {
                let row = view.rows.get(camera.key);
                if (!row) {
                    const figure = document.createElement('figure'), video = document.createElement('video'), caption = document.createElement('figcaption');
                    figure.className = 'camera-tile'; figure.dataset.cameraKey = camera.key;
                    caption.id = `lobby-camera-caption-${++view.nextLabel}`; figure.setAttribute('aria-labelledby', caption.id);
                    video.autoplay = true; video.playsInline = true;
                    figure.append(video, caption); row = { figure, video, caption }; view.rows.set(camera.key, row);
                }
                row.video.muted = camera.self;
                if (row.video.srcObject !== camera.stream) row.video.srcObject = camera.stream;
                row.video.title = camera.name;
                row.video.setAttribute('aria-label', camera.self ? 'Your muted camera preview' : `Camera from ${camera.name}`);
                if (row.caption.textContent !== camera.name) row.caption.textContent = camera.name;
                if (ui.tiles.children[index] !== row.figure) ui.tiles.insertBefore(row.figure, ui.tiles.children[index] || null);
            });
            if (!cameras.length) { view.scrollLeft = 0; ui.tiles.scrollLeft = 0; }
            if (strip) strip.hidden = cameras.length === 0;
            if (countLabel) countLabel.textContent = `Cameras (${cameras.length})`;
            if (summaryCount) { summaryCount.hidden = cameras.length === 0; summaryCount.textContent = cameras.length ? `${cameras.length} camera${cameras.length === 1 ? '' : 's'}` : ''; }
            metrics();
            if (activity?.clientHeight) activity.scrollTop = Math.min(activityTop, Math.max(0, activity.scrollHeight - activity.clientHeight));
            if (wasFocused && !cameras.length) retireCameraFocus(activity);
        }

        return { onJoin, onChan, onCam, onAct, onLeave: teardown };
    }

    window.LobbyRoom = { attach };
})();
