/* #stalemate lobby client. Hidden preview. Everything is rendered with textContent; the server decides every
 * permission and filters every line. This file only draws buttons and sends {t:'say'|'cmd'|...} frames. */
(() => {
    'use strict';
    const $ = (s, el = document) => el.querySelector(s);
    const $$ = (s, el = document) => [...el.querySelectorAll(s)];
    const Discovery = window.HangoutDiscovery;
    const params = new URLSearchParams(location.search);
    let ownerSession = params.get('owner') === '1' || sessionStorage.getItem('hangout-owner') === '1';
    if (ownerSession) sessionStorage.setItem('hangout-owner', '1');
    const isLocal = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
    // Read the preview key once, then drop the query from the address bar (keeps it out of history,
    // screenshots and page analytics).
    const previewKey = params.get('preview') || sessionStorage.getItem('hangout-preview') || '';
    if (params.get('preview')) sessionStorage.setItem('hangout-preview', params.get('preview'));
    const relayBase = ((isLocal && (params.get('relay') || sessionStorage.getItem('hangout-relay'))) || $('meta[name="hangout-relay"]').content || '').replace(/\/$/, '');
    const turnUrl = ((isLocal && params.get('turn')) || $('meta[name="hangout-turn"]').content || '').trim();
    if (isLocal && params.get('relay')) sessionStorage.setItem('hangout-relay', params.get('relay'));
    if (location.search) history.replaceState(null, '', location.pathname + location.hash);
    const siteKey = $('meta[name="hangout-turnstile"]').content || '';

    // GoatCounter: fixed, privacy-safe event names only (no nicks, no room names, no query string).
    const count = (event) => { try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: `hangout-${event}`, title: 'Hang Out', event: true, referrer: '' }); } catch (e) { /* analytics never breaks chat */ } };
    count('lobby-view');
    const KIND_ICON = { lobby: '#', chat: '#', bobross: '🎨', watch: '📺', art: '🖌️', jam: '🎸' };
    const KIND_NAME = { chat: 'Chat channel', bobross: 'Bob Ross paint-along', watch: 'Watch together', art: 'Draw together', jam: 'Jam' };
    const WORDS = ['happy', 'little', 'gross', 'loud', 'feral', 'fuzzy', 'mighty', 'snotty', 'rad', 'grumpy', 'soggy', 'mosh'];
    const THINGS = ['tree', 'cloud', 'possum', 'riff', 'taco', 'goat', 'ghost', 'drip', 'squirrel', 'pickle', 'van', 'amp'];
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const slug = () => `${pick(WORDS)}-${pick(THINGS)}`.replace(/[^a-z0-9-]/g, '');

    const app = window.__lobby = { ws: null, me: '', role: 'fan', band: false, chans: new Map(), pms: new Map(), active: '#stalemate', rooms: [], ignores: new Set(), pending: null };
    // Drafts are tab-local only. Chat, PMs and invitation links are never copied into browser storage.
    const drafts = new Map();
    let connectionState = 'offline';
    let replaying = false;
    let belowFold = 0;
    let roomApi = null;
    function room() {
        if (!roomApi && window.LobbyRoom) {
            roomApi = window.LobbyRoom.attach({ app, send, $, previewKey, turnUrl, isLocal, params });
        }
        return roomApi;
    }
    const nickInput = $('[data-nick]');
    nickInput.value = nickInput.value || localStorage.getItem('hangout-nick') || ''; // blank by default; remembered on this device
    $('[data-reroll]').addEventListener('click', (e) => {
        const r = window.StaleNames.roll();
        nickInput.value = r.name;
        e.currentTarget.textContent = '🎲 Roll again';
        gateStatus(r.legendary ? '✨ LEGENDARY name! Keep it, it’s rare.' : '');
        nickInput.focus();
    });

    const gateStatus = (t) => { $('[data-gate-status]').textContent = t; };
    if (!previewKey) {
        $('[data-gate-copy]').textContent = 'Not open yet. The band is still building this one.';
        $('[data-enter]').hidden = true;
        $('.nickrow').hidden = true;
    }

    let tsWidget = null;
    let tsScript = null;
    let challengeDone = null;
    function loadTurnstile() {
        if (!siteKey) return Promise.resolve('');
        $('[data-guest-check]').hidden = false;
        if (!tsScript) tsScript = new Promise((resolve) => {
            const s = document.createElement('script');
            const timeout = setTimeout(() => fail(), 20000);
            const fail = () => { clearTimeout(timeout); tsScript = null; s.remove(); $('[data-guest-check]').hidden = true; resolve(false); };
            window.__tsReady = () => { clearTimeout(timeout); resolve(true); };
            s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__tsReady&render=explicit';
            s.async = true;
            s.onerror = fail;
            document.head.append(s);
        });
        return tsScript.then((loaded) => loaded ? new Promise((resolve) => {
            // Turnstile responses are single-use: every socket admission gets a new challenge.
            if (challengeDone) challengeDone('');
            let settled = false;
            const timeout = setTimeout(() => finish(''), 20000);
            const finish = (token) => {
                if (settled) return; settled = true;
                clearTimeout(timeout); if (challengeDone === finish) challengeDone = null;
                $('[data-guest-check]').hidden = true; resolve(token);
            };
            challengeDone = finish;
            try {
                if (tsWidget !== null) window.turnstile.reset(tsWidget);
                else tsWidget = window.turnstile.render($('[data-turnstile]'), {
                    sitekey: siteKey, size: 'flexible',
                    callback: (token) => { if (challengeDone) challengeDone(token); },
                    'error-callback': () => { if (challengeDone) challengeDone(''); },
                    'expired-callback': () => { if (challengeDone) challengeDone(''); }
                });
            } catch (err) { tsWidget = null; finish(''); }
        }) : '');
    }

    $('[data-enter]').addEventListener('click', async () => {
        const nick = nickInput.value.trim();
        if (!/^[A-Za-z][A-Za-z0-9_\-[\]{}^`|]{2,19}$/.test(nick)) { nickInput.focus(); return gateStatus('Type a nick (3-20 letters or numbers, start with a letter), or tap 🎲 for a fun one.'); }
        if (!relayBase) return gateStatus('The chat server isn’t switched on yet.');
        gateStatus('Getting you in…');
        connect(nickInput.value.trim());
    });
    $('[data-enter]').disabled = !previewKey || !relayBase;
    nickInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('[data-enter]').click(); });

    let retry = 0;
    let retryTimer;
    let connectionAttempt = 0;
    function setConnection(state) {
        connectionState = state;
        const label = { offline: 'Offline', connecting: 'Connecting…', reconnecting: 'Reconnecting…', connected: 'Connected' }[state];
        $('[data-connection]').textContent = label;
        $('[data-connection]').dataset.state = state;
        $('[data-send]').disabled = state !== 'connected';
        $('[data-enter]').disabled = state === 'connecting' || state === 'reconnecting';
        $('[data-reconnect]').hidden = state !== 'offline' || !app.me;
        $$('[data-start]').forEach((b) => { b.disabled = state !== 'connected'; });
        if (state === 'offline' && app.pendingChannel) {
            app.pendingChannel = '';
            $('[data-channel-error]').textContent = 'Connection lost. Reconnect and try this channel again.';
        }
        drawCommunity(); drawRooms();
    }
    async function connect(nick) {
        const attempt = ++connectionAttempt;
        clearTimeout(retryTimer);
        setConnection(app.me ? 'reconnecting' : 'connecting');
        const tsToken = ownerSession ? '' : await loadTurnstile();
        if (attempt !== connectionAttempt) return;
        if (!ownerSession && siteKey && !tsToken) { setConnection('offline'); return gateStatus('The guest check couldn’t finish. Please try again.'); }
        const q = new URLSearchParams({ preview: previewKey });
        const dev = localStorage.getItem('hangout-dev'); // sent as subprotocol only; server rotates so tokens stay within 24h
        if (tsToken) q.set('ts', tsToken);
        if (app.ws) { app.ws.onclose = null; app.ws.onmessage = null; app.ws.close(1000); }
        const ws = new WebSocket(`${relayBase}/${ownerSession ? 'lobby-owner' : 'lobby'}?${q}`, dev ? ['hangout', 'dev.' + dev] : ['hangout']);
        app.ws = ws;
        let opened = false;
        let sessionNick = nick;
        ws.onopen = () => { opened = true; };
        ws.onmessage = (e) => {
            if (attempt !== connectionAttempt) return;
            let m; try { m = JSON.parse(e.data); } catch (err) { return; }
            if (!m || typeof m !== 'object') return;
            if (m.t === 'welcome') sessionNick = m.nick;
            handle(m, sessionNick);
        };
        ws.onclose = (e) => {
            if (attempt !== connectionAttempt) return;
            setConnection('offline');
            if (roomApi) roomApi.onLeave();
            if (ownerSession && (!opened || e.code === 4401)) { $('[data-gate-guest]').hidden = false; return gateStatus('Email sign-in is unavailable or expired. Sign in again to manage your rooms, or continue as a guest.'); }
            if (!opened) return gateStatus('Couldn’t get in. Maybe it’s full, locked, or you got the boot. Try again in a bit.');
            if ([4001, 4003, 4503, 4403].includes(e.code) || app.kicked || e.code === 1000) return;
            line(app.active, { event: true, text: '* Disconnected. Reconnecting…' });
            setConnection('reconnecting');
            retryTimer = setTimeout(() => connect(app.me || nick), Math.min(10000, 1000 * (2 ** retry++)));
        };
    }
    const send = (obj) => {
        if (!app.ws || app.ws.readyState !== 1) return false;
        if (obj.t !== 'hello' && connectionState !== 'connected') return false;
        app.ws.send(JSON.stringify(obj)); return true;
    };
    const cmd = (name, args = [], ch = app.active) => send({ t: 'cmd', name, args, ch: ch.startsWith('pm:') ? '#stalemate' : ch });
    app.cmd = cmd;

    function handle(m, nick) {
        switch (m.t) {
        case 'rate-limit':
            if (connectionState !== 'connected') { setConnection('offline'); gateStatus(m.text); app.ws?.close(1000); }
            else toast(m.text);
            break;
        case 'ownership': { const c = store(m.ch); if (c) c.cohosts = m.cohosts; break; }
        case 'owner-offer': toast(`${m.by} offered you ownership of ${m.ch}`, [['Accept ownership', () => { if (confirm(`Accept ownership of ${m.ch}?`)) cmd('acceptowner', [], m.ch); }]]); break;
        case 'device': {
            localStorage.setItem('hangout-dev', m.token); // server-rotated; 24h TTL limits stolen-token lifetime
            room()?.onDevice?.();
            break;
        }
        case 'hello':
            app.role = m.role; app.verified = m.verified === true; app.capabilities = m.capabilities || {}; $('[data-owner-signout]').hidden = !ownerSession; app.netLock = m.lock; app.budget = m.budget;
            if (app.me) {
                app.resetSession = true; setConnection('reconnecting');
                drafts.set(app.active, $('[data-text]').value);
                if (roomApi) roomApi.onLeave();
                app.chans.clear(); app.pms.clear(); app.rooms = []; app.active = '#stalemate';
                app.away = false; app.ignores.clear();
                app.restorePmOff = $('[data-pm-off]').checked;
                $('[data-pmreqs]').replaceChildren();
                $('[data-text]').value = drafts.get('#stalemate') || '';
            }
            send({ t: 'hello', nick, age13: true }); break;
        case 'nick-error': setConnection('offline'); gateStatus(m.text); $('[data-gate]').hidden = false; $('[data-app]').hidden = true; break;
        case 'welcome': {
            const wasIn = !!app.me;
            if (!wasIn) count('lobby-join');
            app.verified = m.verified === true; app.capabilities = m.capabilities || app.capabilities;
            $('[data-room-filter] option[value=mine]').disabled = !app.verified;
            app.me = m.nick; app.band = m.band; localStorage.setItem('hangout-nick', m.nick);
            $('[data-self-nick]').textContent = m.nick;
            $('[data-self-role]').textContent = app.capabilities.configure ? 'Site administrator' : app.capabilities.moderate ? 'Community moderator' : app.verified ? 'Room owner account' : 'Guest access';
            app.kicked = false; retry = 0; setConnection('connected');
            const returnRoom = sessionStorage.getItem('hangout-return-room');
            if (returnRoom && app.verified) { sessionStorage.removeItem('hangout-return-room'); cmd('join', [returnRoom]); }
            if (app.restorePmOff) { cmd('pm', ['off']); app.restorePmOff = false; }
            $('[data-gate]').hidden = true; $('[data-app]').hidden = false;
            if (wasIn && app.resetSession) toast('Connected. Room ownership and settings are kept; chat starts fresh. Choose a room to rejoin. Cameras stay off.');
            else if (wasIn) line(app.active, { event: true, text: `* You are now ${m.nick}` });
            app.resetSession = false;
            document.body.classList.toggle('is-band', !!m.band);
            break;
        }
        case 'join': {
            const c = { ...m.ch, lines: [] };
            if (app.pendingChannel === m.ch.name) {
                app.pendingChannel = '';
                $('[data-channel-dialog]').close();
            }
            app.chans.set(m.ch.name, c);
            // Classic IRC: joining begins a fresh buffer; never render pre-join backlog.
            if (m.act) c.actSnap = m.act;
            const cur = store(app.active);
            if (m.ch.name === '#stalemate' && cur && cur.kind !== 'lobby' && cur.kind !== 'jam') break;
            switchTo(m.ch.name); // switchTo calls room.onJoin with actSnap
            break;
        }
        case 'chan': {
            const c = app.chans.get(m.ch.name);
            if (c) {
                Object.assign(c, m.ch);
                if (app.active === c.name) drawChan();
                const r = room();
                if (r) r.onChan(c);
            }
            drawCommunity();
            break;
        }
        case 'act': {
            const r = room();
            if (r) r.onAct(m);
            const ch = app.chans.get(m.ch);
            if (ch && window.__lobbyRoom) {
                ch.actSnap = { strokes: window.__lobbyRoom.state.room.strokes.slice(-400), video: window.__lobbyRoom.state.room.video };
            }
            break;
        }
        case 'part': case 'closed': {
            app.chans.delete(m.ch);
            if (m.t === 'closed') toast(`${m.ch} was ${m.reason}.`);
            if (app.active === m.ch) switchTo('#stalemate');
            drawTabs();
            break;
        }
        case 'line': pushLine(m.ch, m); break;
        case 'event': pushLine(m.ch, { ...m, event: true }); break;
        case 'notice':
            line(app.active, { notice: true, from: m.from, text: m.text, kind: m.kind });
            if (m.kind === 'error') {
                if (app.pendingChannel && $('[data-channel-dialog]').open) {
                    $('[data-channel-error]').textContent = m.text;
                    app.pendingChannel = '';
                } else toast(m.text);
            }
            break;
        case 'denied': line(app.active, { notice: true, from: 'StaleBot', text: m.text, kind: 'error' }); break;
        case 'list': app.rooms = m.rooms; drawRooms(); if (m.show) show('rooms'); break;
        case 'delete': for (const c of [...app.chans.values(), ...app.pms.values()]) c.lines = c.lines.filter((l) => !m.ids.includes(l.id)); $$('[data-id]').forEach((li) => { if (m.ids.includes(li.dataset.id)) li.remove(); }); break;
        case 'pm-request': pmRequest(m.from, m.band); break;
        case 'pm-open': openPm(m.with, true); break;
        case 'pm-closed': toast(`PM with ${m.with} closed.`); break;
        case 'pm': { const other = m.from === app.me ? m.to : m.from; openPm(other, false); pushLine(`pm:${other}`, { ...m, ch: `pm:${other}` }); break; }
        case 'pm-setting': $('[data-pm-off]').checked = m.off; toast(m.text); break;
        case 'invite': toast(`${m.by} invited you to ${m.ch}`, [['Join', () => cmd('join', [m.ch])]]); break;
        case 'kicked': app.kicked = m.ch === '#stalemate'; toast(`${m.banned ? 'Banned' : 'Kicked'} from ${m.ch} by ${m.by}: ${m.reason}`); if (app.kicked) { $('[data-gate]').hidden = false; $('[data-app]').hidden = true; gateStatus(`You got the boot (${m.reason}). Take a breather.`); } break;
        case 'cam': {
            const c = app.chans.get(m.ch);
            if (c) c.myCam = m.on;
            if (app.active === m.ch) drawChan();
            const r = room();
            if (r) r.onCam(m.ch, m.on);
            if (m.by && !m.on) toast(`Camera switched off by ${m.by}.`);
            break;
        }
        case 'cam-gate': $('[data-cam-gate]').showModal(); break;
        case 'net': app.netLock = m.lock; drawCommunity(); if (m.shield) toast('🛡️ Shield’s up: slow mode, cameras off for a bit.'); break;
        case 'modlog': m.entries.forEach((e) => line(app.active, { notice: true, from: 'log', text: `${new Date(e.at).toLocaleTimeString()} ${e.by} ${e.action} ${e.target} ${e.reason}` })); break;
        default: break;
        }
    }

    function store(key) { return key.startsWith('pm:') ? app.pms.get(key.slice(3)) : app.chans.get(key); }
    function pushLine(key, l) {
        const c = store(key);
        if (!c) return;
        c.lines.push(l);
        if (c.lines.length > 300) c.lines.shift();
        if (app.active === key) appendLine(l); else {
            if (!l.event && !l.notice && l.from !== app.me) {
                c.unread = (c.unread || 0) + 1;
                if (Discovery.isMention(l.text, app.me)) c.mentions = (c.mentions || 0) + 1;
            }
            drawTabs();
        }
    }
    function line(key, l) { pushLine(store(key) ? key : '#stalemate', l); }

    const hhmm = (ts) => { const d = ts ? new Date(ts) : new Date(); return `[${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}]`; };
    const colorOf = (nick) => { let h = 0; for (const ch of String(nick || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 80% 70%)`; };
    function appendLine(l) {
        const buf = $('[data-buffer]');
        const li = document.createElement('li');
        if (l.id) li.dataset.id = l.id;
        const ts = document.createElement('span'); ts.className = 'ts'; ts.textContent = hhmm(l.ts); li.append(ts, ' ');
        if (l.event) { li.className = 'ev'; li.append(l.text.startsWith('*') ? l.text : `* ${l.text}`); }
        else if (l.notice) { li.className = `notice ${l.kind || ''}`; const b = document.createElement('b'); b.textContent = `-${l.from}-`; li.append(b, ' ', l.text); }
        else {
            if (l.from !== app.me && Discovery.isMention(l.text, app.me)) li.classList.add('mention');
            const who = document.createElement('button');
            who.type = 'button'; who.className = 'who'; who.style.color = colorOf(l.from);
            who.textContent = l.me ? `* ${l.prefix || ''}${l.from}` : `<${l.prefix || ''}${l.from}>`;
            who.addEventListener('click', () => nickSheet(l.from));
            li.append(who);
            if (l.moderator) { const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = 'MOD'; li.append(' ', badge); }
            if (l.band) { const s = document.createElement('span'); s.className = 'badge'; s.textContent = '⭐ BAND'; li.append(' ', s); }
            li.append(' ', l.text);
            if (l.from !== app.me && l.id) {
                const r = document.createElement('button'); r.type = 'button'; r.className = 'flag'; r.textContent = '🚩'; r.setAttribute('aria-label', `Report this message from ${l.from}`);
                r.addEventListener('click', () => { send({ t: 'report', id: l.id }); r.disabled = true; });
                li.append(r);
            }
            if (l.me) li.classList.add('act');
        }
        const stick = buf.scrollHeight - buf.scrollTop - buf.clientHeight < 60;
        buf.append(li);
        while (buf.children.length > 300) buf.firstChild.remove();
        if (stick) buf.scrollTop = buf.scrollHeight;
        else if (!replaying && !l.event) { belowFold += 1; drawNewMessages(); }
    }

    function drawNewMessages() {
        const b = $('[data-new-messages]'); b.hidden = belowFold === 0;
        b.textContent = `${belowFold} new message${belowFold === 1 ? '' : 's'} ↓`;
    }
    $('[data-new-messages]').addEventListener('click', () => {
        const buf = $('[data-buffer]'); buf.scrollTop = buf.scrollHeight;
        belowFold = 0; drawNewMessages();
    });
    $('[data-buffer]').addEventListener('scroll', () => {
        const buf = $('[data-buffer]');
        if (buf.scrollHeight - buf.scrollTop - buf.clientHeight < 60) { belowFold = 0; drawNewMessages(); }
    });

    function switchTo(key) {
        const prev = app.active;
        if (prev !== key) { drafts.set(prev, $('[data-text]').value); $('[data-text]').value = drafts.get(key) || ''; }
        app.active = key;
        const c = store(key);
        if (c) { c.unread = 0; c.mentions = 0; }
        belowFold = 0; drawNewMessages(); replaying = true;
        $('[data-buffer]').replaceChildren();
        (c ? c.lines : []).forEach(appendLine);
        replaying = false;
        drawTabs(); drawChan();
        drawCommunity(); drawRooms();
        show('chat');
        const buf = $('[data-buffer]'); buf.scrollTop = buf.scrollHeight;
        const r = room();
        if (r) {
            if (prev !== key && c && c.kind !== 'lobby' && c.kind !== 'jam') r.onJoin(c, c.actSnap);
            else if (prev !== key && (!c || c.kind === 'lobby' || c.kind === 'jam')) r.onLeave();
        }
    }

    function drawTabs() {
        const nav = $('[data-tabs]');
        const focusKey = nav.contains(document.activeElement) ? document.activeElement.dataset.channelKey : null;
        nav.replaceChildren();
        let totalUnread = 0;
        const mk = (key, label, unread, mentions) => {
            const b = document.createElement('button');
            b.type = 'button'; b.role = 'tab'; b.textContent = unread ? `${label} (${unread}${mentions ? ' · @you' : ''})` : label;
            b.dataset.channelKey = key;
            b.setAttribute('aria-selected', String(app.active === key));
            b.tabIndex = app.active === key ? 0 : -1;
            b.classList.toggle('has-mention', !!mentions);
            totalUnread += unread || 0;
            b.addEventListener('click', () => switchTo(key));
            nav.append(b);
        };
        for (const c of app.chans.values()) mk(c.name, `${KIND_ICON[c.kind] === '#' ? '' : `${KIND_ICON[c.kind]} `}${c.name}`, c.unread, c.mentions);
        for (const [nick, p] of app.pms) mk(`pm:${nick}`, `✉ ${nick}`, p.unread, p.mentions);
        if (focusKey) $$('[role="tab"]', nav).find((b) => b.dataset.channelKey === focusKey)?.focus({ preventScroll: true });
        document.title = `${totalUnread ? `(${totalUnread}) ` : ''}#stalemate · Hang Out`;
    }
    $('[data-tabs]').addEventListener('keydown', (e) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        const tabs = $$('[role="tab"]', e.currentTarget);
        const at = tabs.indexOf(document.activeElement); if (at < 0) return;
        const index = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        e.preventDefault(); tabs[index].click(); $$('[role="tab"]', e.currentTarget)[index]?.focus();
    });

    const amOp = (c) => app.band || (c && c.names && c.names.some((n) => n.nick === app.me && n.prefix === '@'));
    function drawChan() {
        const key = app.active;
        const c = store(key);
        const isPm = key.startsWith('pm:');
        $('[data-lobby-welcome]').hidden = key !== '#stalemate';
        $('[data-chat-context]').textContent = isPm ? `PM · ${key.slice(3)}` : key;
        $('[data-topic]').textContent = isPm ? `Private chat with ${key.slice(3)} · filtered · tap their name to block` : c ? `${c.topic || ''}` : '';
        const room = !isPm && c && c.kind !== 'lobby';
        $('[data-roombar]').hidden = !room;
        $('[data-jam]').hidden = !(room && c.kind === 'jam');
        const showAct = room && ['bobross', 'watch', 'art'].includes(c.kind);
        $('[data-activity]').hidden = !showAct;
        $('[data-activity-title]').textContent = showAct ? c.kind === 'art' ? 'A canvas for everyone' : c.kind === 'bobross' ? 'A little paint. A little Bob Ross.' : 'Watching together' : 'Shared activity';
        $('[data-act-stage]').hidden = !showAct;
        document.body.classList.toggle('am-op', !!(c && amOp(c)));
        if (room) {
            const m = c.modes;
            const hosts = c.names.filter((n) => n.prefix === '@').map((n) => n.nick);
            $('[data-host-status]').textContent = (c.persistent ? `Registered · expires ${new Date(c.expiresAt).toLocaleDateString()} · ` : 'Temporary · ') + (amOp(c) ? 'You have @ host controls · /op nick adds a co-host' : hosts.length ? `Hosts: ${hosts.map((nick) => `@${nick}`).join(', ')}` : 'No room host online. An existing host can return, or a site moderator can help.');
            $('[data-modes]').textContent = `${KIND_NAME[c.kind]} · +t${m.m ? 'm' : ''}${m.i ? 'i' : ''}${m.k ? 'k' : ''}${m.C ? 'C' : ''}${m.Q ? 'Q' : ''}${m.S ? ` slow ${m.S}s` : ''}${m.locked ? ' 🔒' : ''} · ${c.count}/${m.l}`;
            const cam = $('[data-cam]');
            cam.hidden = c.kind === 'chat';
            cam.setAttribute('aria-pressed', String(!!c.myCam));
            cam.textContent = c.myCam ? '📷 Camera on' : m.C ? '📷 Camera (18+)' : '📷 Cameras off here';
            cam.disabled = !m.C && !c.myCam;
            if (c.kind === 'jam') {
                const a = $('[data-jam-desktop]');
                const link = c.jam && c.jam.desktop;
                const invitation = c.jam && (c.jam.invitation || link);
                a.hidden = !link; $('[data-jam-wait]').hidden = !!invitation;
                $('[data-jam-copy]').hidden = !invitation;
                $('[data-jam-copy-fallback]').hidden = true;
                $('[data-jam-copy-value]').value = '';
                if (link && /^webjam:\/\//.test(link)) a.setAttribute('href', link);
                else a.removeAttribute('href');
                const web = $('[data-jam-web]');
                web.disabled = !(c.jam && c.jam.webReady);
                web.textContent = web.disabled ? 'Browser join unavailable' : 'Join in browser (higher delay)';
                web.onclick = () => { if (c.jam && /^https:\/\//.test(c.jam.web)) window.open(c.jam.web, '_blank', 'noopener,noreferrer'); };
            }
        }
        $('[data-people-title]').textContent = isPm ? 'PM' : c ? `${c.name} · ${c.count || c.names?.length || 0}` : 'People';
        const ul = $('[data-nicks]');
        ul.replaceChildren();
        (c && c.names || []).forEach((n) => {
            const li = document.createElement('li');
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'nick'; b.style.color = colorOf(n.nick);
            b.dataset.self = String(n.nick === app.me);
            b.textContent = `${n.prefix}${n.nick}${n.band ? ' ⭐' : n.moderator ? ' MOD' : ''}${n.cam ? ' 📷' : ''}${n.away ? ' 💤' : ''}`;
            b.addEventListener('click', () => nickSheet(n.nick));
            li.append(b); ul.append(li);
        });
    }

    function drawRooms() {
        const ul = $('[data-roomlist]');
        ul.replaceChildren();
        const query = $('[data-room-search]').value.trim().toLowerCase();
        const filter = $('[data-room-filter]').value;
        const rooms = Discovery.describeRooms(app.rooms.filter((r) =>
            (filter === 'mine' ? r.mine : filter === 'registered' ? r.persistent : r.count > 0 || !r.persistent)
            && (!query || `${r.name} ${r.title}`.toLowerCase().includes(query))), [...app.chans.keys()]);
        $('[data-room-count]').textContent = String(rooms.length);
        $('[data-rooms-empty]').hidden = rooms.length > 0;
        for (const r of rooms) {
            const li = document.createElement('li');
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'room';
            b.dataset.room = r.name;
            b.dataset.state = r.state;
            b.disabled = !r.canJoin || connectionState !== 'connected';
            const t = document.createElement('b'); t.textContent = `${KIND_ICON[r.kind]} ${r.title}`;
            const s = document.createElement('span'); s.textContent = `${r.name} · ${r.count}/${r.max} here · ${r.persistent ? 'Registered' : 'Temporary'} · ${r.hostPresent ? 'Host here' : 'Host away'}`;
            const action = document.createElement('span'); action.className = 'room-action'; action.textContent = `${r.statusLabel} · ${r.actionLabel}`;
            b.append(t, s, action);
            b.addEventListener('click', () => {
                if (app.chans.has(r.name)) return switchTo(r.name);
                if (r.key) { const k = prompt(`${r.name} has a key. Type it:`) || ''; return cmd('join', [r.name, k]); }
                return cmd('join', [r.name]);
            });
            li.append(b); ul.append(li);
        }
    }

    $('[data-room-filter]').addEventListener('change', drawRooms);
    $('[data-room-search]').addEventListener('input', drawRooms);
    $('[data-owner-signin]').href = relayBase ? `${relayBase.replace(/^ws/, 'http')}/lobby-owner/login` : '#';
    $('[data-gate-guest]').hidden = !ownerSession;
    $('[data-gate-guest]').addEventListener('click', () => { ownerSession = false; sessionStorage.removeItem('hangout-owner'); $('[data-gate-guest]').hidden = true; connect(app.me || nickInput.value); });
    $('[data-owner-signout]').addEventListener('click', () => {
        ownerSession = false; sessionStorage.removeItem('hangout-owner'); connect(app.me || nickInput.value);
    });
    function drawCommunity() {
        const lobby = app.chans.get('#stalemate');
        const summary = Discovery.summarizeLobby(lobby, app.me);
        const connected = connectionState === 'connected';
        $('[data-lobby-count]').textContent = connected ? `${summary.others + (app.me ? 1 : 0)} here · chat` : 'Main conversation';
        $('[data-presence-title]').textContent = connected ? summary.headline : 'Connection paused';
        $('[data-presence-detail]').textContent = connected ? summary.detail : 'Room counts may be out of date. Your unsent words stay in this tab.';
        $('[data-welcome-title]').textContent = summary.others ? 'A good conversation starts with a hello.' : 'First one here? Make yourself at home.';
        const paused = !app.band && (app.netLock === 'readonly' || app.budget === 'readonly');
        const note = $('[data-network-note]');
        note.hidden = !paused && connected;
        note.textContent = !connected ? 'You’re offline. Your draft stays here until you reconnect.' : 'Chat is read-only for now. Your unsent draft stays here.';
    }
    $('[data-lobby-home]').addEventListener('click', () => { if (app.chans.has('#stalemate')) switchTo('#stalemate'); });
    $('[data-reconnect]').addEventListener('click', () => connect(app.me || nickInput.value.trim()));
    $$('[data-prompt]').forEach((b) => b.addEventListener('click', () => {
        const input = $('[data-text]');
        if (input.value.trim()) return toast('You already have a draft. Send it or clear it first.');
        input.value = b.dataset.prompt; input.focus();
    }));

    // Activity tiles pick a name; plain chat lets guests name their own channel.
    $$('[data-start]').forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.start === 'chat') {
            $('[data-channel-error]').textContent = '';
            $('[data-channel-dialog]').showModal();
            $('[data-channel-name]').focus();
            return;
        }
        count(`room-start-${b.dataset.start}`); cmd('join', [`#${b.dataset.start}-${slug()}`]);
    }));
    $('[data-channel-cancel]').addEventListener('click', () => $('[data-channel-dialog]').close());
    $('[data-channel-dialog]').addEventListener('close', () => { app.pendingChannel = ''; });
    $('[data-channel-form]').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = `#${$('[data-channel-name]').value.trim().replace(/^#/, '').toLowerCase()}`;
        if (!/^#[a-z0-9-]{2,30}$/.test(name)) {
            $('[data-channel-error]').textContent = 'Use 2–30 letters, numbers or dashes.';
            $('[data-channel-name]').focus();
            return;
        }
        if (app.chans.has(name)) {
            $('[data-channel-dialog]').close();
            switchTo(name);
            return;
        }
        if (/^#(?:art|watch|bobross|jam)(?:-|$)/.test(name) && !app.rooms.some((r) => r.name === name)) {
            $('[data-channel-error]').textContent = 'That name starts an activity room. Choose another name for chat, or use the activity buttons.';
            $('[data-channel-name]').focus();
            return;
        }
        if (!cmd('join', [name])) {
            $('[data-channel-error]').textContent = 'Reconnect before joining a channel. Your name stays here.';
            return;
        }
        app.pendingChannel = name;
        $('[data-channel-error]').textContent = 'Joining…';
        count('room-start-chat');
    });
    $('[data-private]').addEventListener('click', () => count('room-start-private'));

    function openPm(nick, focus) {
        if (!app.pms.has(nick)) app.pms.set(nick, { lines: [], unread: 0, names: [{ nick, prefix: '' }, { nick: app.me, prefix: '' }] });
        drawTabs();
        if (focus) switchTo(`pm:${nick}`);
    }
    function pmRequest(from, band) {
        const box = $('[data-pmreqs]');
        const div = document.createElement('div');
        div.className = 'req';
        const p = document.createElement('span'); p.textContent = `✉ ${from}${band ? ' ⭐' : ''} wants to chat`;
        div.append(p);
        for (const [label, fn] of [['Accept', () => cmd('accept', [from])], ['No thanks', () => cmd('decline', [from])], ['Block', () => cmd('block', [from])]]) {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn--small'; b.textContent = label;
            b.addEventListener('click', () => { fn(); div.remove(); });
            div.append(b);
        }
        box.append(div);
    }

    function nickSheet(nick) {
        if (!nick || nick === app.me) return;
        const c = store(app.active);
        const sheet = $('[data-sheet]');
        $('[data-sheet-title]').textContent = nick;
        const box = $('[data-sheet-buttons]');
        box.replaceChildren();
        const act = (label, fn, cls = '') => { const b = document.createElement('button'); b.type = 'button'; b.className = `btn ${cls}`; b.textContent = label; b.addEventListener('click', () => { fn(); sheet.close(); }); box.append(b); };
        act('✉ PM', () => cmd('query', [nick]));
        act('🐟 Slap', () => cmd('slap', [nick]));
        act('Who?', () => cmd('whois', [nick]));
        act(app.ignores.has(nick) ? 'Unignore' : 'Ignore', () => { if (app.ignores.has(nick)) { app.ignores.delete(nick); cmd('unignore', [nick]); } else { app.ignores.add(nick); cmd('ignore', [nick]); } });
        act('Block', () => cmd('block', [nick]), 'btn--ghost');
        act('🚩 Report', () => cmd('report', [nick]), 'btn--ghost');
        if (amOp(c)) {
            act('Kick', () => cmd('kick', [nick, 'take a breather']), 'btn--danger');
            act('Ban', () => { const why = prompt(`Ban ${nick}. Reason?`) || ''; if (why) cmd('ban', [nick, ...why.split(' ')]); }, 'btn--danger');
            if (c && c.kind !== 'lobby') { act('Make @', () => cmd('op', [nick])); act('Give voice', () => cmd('voice', [nick])); act('Invite here', () => cmd('invite', [nick, c.name])); }
            if (app.band) act('Mute 10m', () => cmd('mute', [nick, '10m']), 'btn--danger');
        }
        sheet.showModal();
    }
    $('[data-sheet-close]').addEventListener('click', () => $('[data-sheet]').close());

    // Command palette: every slash command as a button.
    const PALETTE = [
        ['/me', 'me', 'does what? (e.g. moshes)'], ['/nick', 'nick', 'new nick'], ['/away', 'away', 'reason (blank = back)'], ['/list', 'list'], ['/names', 'names'],
        ['/topic', 'topic'], ['/whois', 'whois', 'nick'], ['/msg', 'msg', 'nick then message'], ['/ignore', 'ignore', 'nick'], ['/join', 'join', '#room'],
        ['/slap', 'slap', 'nick'], ['/help', 'help'], ['/quit', 'quit']
    ];
    const OP_PALETTE = [['/mode +m', 'mode', null, ['+m']], ['/mode -m', 'mode', null, ['-m']], ['/mode +i', 'mode', null, ['+i']], ['/mode -i', 'mode', null, ['-i']], ['Slow 10s', 'mode', null, ['+S', '10']], ['Slow off', 'mode', null, ['-S']],
        ['Cams off', 'mode', null, ['-C']], ['Cams allowed', 'mode', null, ['+C']], ['/topic …', 'topic', 'new topic'], ['🔒 Lock', 'lock'], ['🔓 Unlock', 'lock', null, ['off']], ['Add guest co-host', 'op', 'nickname'], ['Remove guest co-host', 'deop', 'nickname'], ['Keep this room', 'register'], ['Add verified co-host', 'cohost', 'add nickname'], ['Remove verified co-host', 'cohost', 'remove nickname'], ['Transfer ownership', 'transfer', 'verified co-host nickname'], ['Delete registration', 'unregister'], ['Close room', 'close']];
    function openPalette(ops) {
        const box = $('[data-palette-buttons]');
        const current = store(app.active);
        const owner = current?.names?.find((n) => n.nick === app.me)?.owner;
        box.replaceChildren();
        for (const [label, name, ask, fixed] of (ops ? OP_PALETTE : PALETTE)) {
            if (name === 'register' && current?.persistent) continue;
            if (['cohost', 'transfer', 'unregister'].includes(name) && !owner) continue;
            if (current?.persistent && ['op', 'deop', 'close'].includes(name) && !owner && !app.capabilities?.configure) continue;
            if (store(app.active)?.kind === 'chat' && name === 'mode' && ['+C', '-C'].includes(fixed?.[0])) continue;
            const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn--small'; b.textContent = label;
            b.addEventListener('click', () => {
                $('[data-palette]').close();
                if (['deop', 'unregister', 'transfer', 'close'].includes(name) && !confirm(current?.persistent && ['close', 'unregister'].includes(name) ? `Permanently delete ${app.active} and release its registered name?` : `${label} in ${app.active}?`)) return;
                if (name === 'register' && !app.verified) { sessionStorage.setItem('hangout-return-room', app.active); location.assign($('[data-owner-signin]').href); return; }
                if (name === 'cohost') { const who = prompt(`${label}: nickname`); if (!who) return; if (label.startsWith('Remove') && !confirm(`Remove ${who} as co-host?`)) return; return cmd(name, [label.startsWith('Remove') ? 'remove' : 'add', who.trim()]); }
                if (fixed) return cmd(name, fixed);
                if (ask) { const v = prompt(`${label}: ${ask}`); if (v === null) return undefined; return cmd(name, v.trim() ? v.trim().split(' ') : []); }
                return cmd(name, []);
            });
            box.append(b);
        }
        if (ops && owner) for (const host of current.cohosts || []) {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn--small'; b.textContent = `Remove verified co-host: ${host.label}`;
            b.addEventListener('click', () => { if (confirm(`Remove ${host.label} as a verified co-host?`)) { cmd('cohost', ['remove', host.id]); $('[data-palette]').close(); } }); box.append(b);
        }
        $('[data-palette]').showModal();
    }
    $('[data-palette-open]').addEventListener('click', () => openPalette(false));
    $('[data-roomtools]').addEventListener('click', () => openPalette(true));
    $('[data-palette-close]').addEventListener('click', () => $('[data-palette]').close());

    $('[data-say]').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = $('[data-text]');
        const text = input.value.trim();
        if (!text) return;
        if (connectionState !== 'connected') return toast('Not connected yet. Your draft is still here.');
        if (!app.band && (app.netLock === 'readonly' || app.budget === 'readonly') && !text.startsWith('/')) return toast('Chat is paused. Your draft is still here.');
        const sent = app.active.startsWith('pm:') && !text.startsWith('/') ? cmd('msg', [app.active.slice(3), ...text.split(' ')]) : send({ t: 'say', ch: app.active.startsWith('pm:') ? '#stalemate' : app.active, text });
        if (sent) { input.value = ''; drafts.delete(app.active); }
    });
    $$('[data-quick-line]').forEach((b) => b.addEventListener('click', () => send({ t: 'say', ch: app.active, text: b.dataset.quickLine })));
    $$('[data-quick-me]').forEach((b) => b.addEventListener('click', () => cmd('me', [b.dataset.quickMe])));
    $$('[data-quick-cmd]').forEach((b) => b.addEventListener('click', () => {
        const name = b.dataset.quickCmd;
        if (name === 'slap') { const c = store(app.active); const others = (c && c.names || []).filter((n) => n.nick !== app.me); const who = others.length ? pick(others).nick : ''; return who ? cmd('slap', [who]) : toast('Nobody here to slap. Yet.'); }
        if (name === 'away') { app.away = !app.away; return cmd('away', app.away ? ['grabbing', 'a', 'snack'] : []); }
        return cmd(name, []);
    }));
    $('[data-leave]').addEventListener('click', () => cmd('part', [app.active]));
    $('[data-pm-off]').addEventListener('change', (e) => cmd('pm', [e.target.checked ? 'off' : 'on']));
    $('[data-cam]').addEventListener('click', () => {
        const c = store(app.active);
        if (!c) return;
        if (c.myCam) return send({ t: 'cam', ch: c.name, on: false });
        $('[data-adult]').checked = false;
        return $('[data-cam-gate]').showModal();
    });
    $('[data-cam-yes]').addEventListener('click', () => { if (!$('[data-adult]').checked) return toast('Tick the 18+ box first.'); send({ t: 'cam', ch: app.active, on: true, adult18: true }); return $('[data-cam-gate]').close(); });
    $('[data-cam-no]').addEventListener('click', () => $('[data-cam-gate]').close());
    $('[data-jam-form]').addEventListener('submit', (e) => { e.preventDefault(); const v = $('[data-jam-link]').value; if (v && cmd('jamlink', ['invitation', v])) $('[data-jam-link]').value = ''; });
    $('[data-jam-copy]').addEventListener('click', async () => {
        const c = store(app.active);
        const link = c?.kind === 'jam' && (c.jam?.invitation || c.jam?.desktop);
        if (!link) return;
        try {
            await navigator.clipboard.writeText(link);
            toast('Invite copied. Open WebJam, choose Join, and paste it there.');
        } catch (_) {
            // Clipboard access is unavailable in some embedded browsers. Keep the
            // invitation in this room only; never place its bearer in storage.
            if (app.active !== c.name || (store(app.active)?.jam?.invitation || store(app.active)?.jam?.desktop) !== link) return;
            $('[data-jam-copy-fallback]').hidden = false;
            const input = $('[data-jam-copy-value]');
            input.value = link; input.focus(); input.select();
        }
    });

    function show(pane) {
        document.body.dataset.show = pane;
        $$('[data-show]').forEach((b) => (b.dataset.show === pane ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
    }
    $$('[data-show]').forEach((b) => b.addEventListener('click', () => show(b.dataset.show)));
    show('chat');

    let toastTimer;
    function toast(text, actions = []) {
        const t = $('[data-toast]');
        t.replaceChildren(text);
        for (const [label, fn] of actions) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn--small'; b.textContent = label; b.addEventListener('click', () => { fn(); t.hidden = true; }); t.append(' ', b); }
        t.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { t.hidden = true; }, actions.length ? 12000 : 4000);
    }
})();
