/* #stalemate lobby client. Hidden preview. Everything is rendered with textContent; the server decides every
 * permission and filters every line. This file only draws buttons and sends {t:'say'|'cmd'|...} frames. */
(() => {
    'use strict';
    const $ = (s, el = document) => el.querySelector(s);
    const $$ = (s, el = document) => [...el.querySelectorAll(s)];
    const params = new URLSearchParams(location.search);
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
    const KIND_ICON = { lobby: '#', bobross: '🎨', watch: '📺', art: '🖌️', jam: '🎸' };
    const KIND_NAME = { bobross: 'Bob Ross paint-along', watch: 'Watch together', art: 'Art on camera', jam: 'Jam' };
    const WORDS = ['happy', 'little', 'gross', 'loud', 'feral', 'fuzzy', 'mighty', 'snotty', 'rad', 'grumpy', 'soggy', 'mosh'];
    const THINGS = ['tree', 'cloud', 'possum', 'riff', 'taco', 'goat', 'ghost', 'drip', 'squirrel', 'pickle', 'van', 'amp'];
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const slug = () => `${pick(WORDS)}-${pick(THINGS)}`.replace(/[^a-z0-9-]/g, '');

    const app = window.__lobby = { ws: null, me: '', role: 'fan', band: false, chans: new Map(), pms: new Map(), active: '#stalemate', rooms: [], ignores: new Set(), pending: null };
    let roomApi = null;
    function room() {
        if (!roomApi && window.LobbyRoom) {
            roomApi = window.LobbyRoom.attach({ app, send, $, previewKey, turnUrl, isLocal, params });
        }
        return roomApi;
    }
    const nickInput = $('[data-nick]');
    nickInput.value = localStorage.getItem('hangout-nick') || ''; // blank by default; remembered on this device
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

    let tsToken = '';
    function loadTurnstile() {
        if (!siteKey) return Promise.resolve('');
        return new Promise((resolve) => {
            window.__tsReady = () => window.turnstile.render($('[data-turnstile]'), { sitekey: siteKey, size: 'invisible', callback: (t) => resolve(t), 'error-callback': () => resolve('') });
            const s = document.createElement('script');
            s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__tsReady&render=explicit';
            s.async = true;
            document.head.append(s);
        });
    }

    $('[data-enter]').addEventListener('click', async () => {
        const nick = nickInput.value.trim();
        if (!/^[A-Za-z][A-Za-z0-9_\-[\]{}^`|]{2,19}$/.test(nick)) { nickInput.focus(); return gateStatus('Type a nick (3-20 letters or numbers, start with a letter), or tap 🎲 for a fun one.'); }
        if (!relayBase) return gateStatus('The chat server isn’t switched on yet.');
        gateStatus('Getting you in…');
        tsToken = tsToken || await loadTurnstile();
        connect(nickInput.value.trim());
    });
    nickInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('[data-enter]').click(); });

    let retry = 0;
    function connect(nick) {
        const q = new URLSearchParams({ preview: previewKey });
        const dev = localStorage.getItem('hangout-dev'); // sent as subprotocol only; server rotates so tokens stay within 24h
        if (tsToken) q.set('ts', tsToken);
        if (app.ws && !app.me) { app.ws.onclose = null; app.ws.close(1000); }
        const ws = new WebSocket(`${relayBase}/lobby?${q}`, dev ? ['hangout', 'dev.' + dev] : ['hangout']);
        app.ws = ws;
        let opened = false;
        ws.onopen = () => { opened = true; retry = 0; };
        ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } handle(m, nick); };
        ws.onclose = (e) => {
            if (!opened) return gateStatus('Couldn’t get in. Maybe it’s full, locked, or you got the boot. Try again in a bit.');
            if ([4001, 4003, 4503, 4403].includes(e.code) || app.kicked) return;
            if (e.code === 1000) return;
            line(app.active, { event: true, text: '* Disconnected. Reconnecting…' });
            setTimeout(() => connect(app.me || nick), Math.min(10000, 1000 * (2 ** retry++)));
        };
    }
    const send = (obj) => { if (app.ws && app.ws.readyState === 1) app.ws.send(JSON.stringify(obj)); };
    const cmd = (name, args = [], ch = app.active) => send({ t: 'cmd', name, args, ch: ch.startsWith('pm:') ? '#stalemate' : ch });
    app.cmd = cmd;

    function handle(m, nick) {
        switch (m.t) {
        case 'device': localStorage.setItem('hangout-dev', m.token); break; // server-rotated; 24h TTL limits stolen-token lifetime
        case 'hello': app.role = m.role; send({ t: 'hello', nick: app.me || nick, age13: true }); break;
        case 'nick-error': gateStatus(m.text); $('[data-gate]').hidden = false; $('[data-app]').hidden = true; break;
        case 'welcome': {
            const wasIn = !!app.me;
            if (!wasIn) count('lobby-join');
            app.me = m.nick; app.band = m.band; localStorage.setItem('hangout-nick', m.nick);
            $('[data-gate]').hidden = true; $('[data-app]').hidden = false;
            if (wasIn) line(app.active, { event: true, text: `* You are now ${m.nick}` });
            document.body.classList.toggle('is-band', !!m.band);
            break;
        }
        case 'join': {
            const c = { ...m.ch, lines: [] };
            app.chans.set(m.ch.name, c);
            // Classic IRC: joining begins a fresh buffer; never render pre-join backlog.
            if (m.act) c.actSnap = m.act;
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
        case 'notice': line(app.active, { notice: true, from: m.from, text: m.text, kind: m.kind }); break;
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
        case 'net': if (m.shield) toast('🛡️ Shield’s up: slow mode, cameras off for a bit.'); break;
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
        if (app.active === key) appendLine(l); else { c.unread = (c.unread || 0) + (l.event ? 0 : 1); drawTabs(); }
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
            const who = document.createElement('button');
            who.type = 'button'; who.className = 'who'; who.style.color = colorOf(l.from);
            who.textContent = l.me ? `* ${l.prefix || ''}${l.from}` : `<${l.prefix || ''}${l.from}>`;
            who.addEventListener('click', () => nickSheet(l.from));
            li.append(who);
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
    }

    function switchTo(key) {
        const prev = app.active;
        app.active = key;
        const c = store(key);
        if (c) c.unread = 0;
        $('[data-buffer]').replaceChildren();
        (c ? c.lines : []).forEach(appendLine);
        drawTabs(); drawChan();
        show('chat');
        const buf = $('[data-buffer]'); buf.scrollTop = buf.scrollHeight;
        const r = room();
        if (r) {
            if (prev !== key && c && c.kind !== 'lobby' && c.kind !== 'jam') r.onJoin(c, c.actSnap);
            else if (!c || c.kind === 'lobby' || c.kind === 'jam') r.onLeave();
        }
    }

    function drawTabs() {
        const nav = $('[data-tabs]');
        nav.replaceChildren();
        const mk = (key, label, unread) => {
            const b = document.createElement('button');
            b.type = 'button'; b.role = 'tab'; b.textContent = unread ? `${label} (${unread})` : label;
            b.setAttribute('aria-selected', String(app.active === key));
            b.addEventListener('click', () => switchTo(key));
            nav.append(b);
        };
        for (const c of app.chans.values()) mk(c.name, `${KIND_ICON[c.kind] === '#' ? '' : `${KIND_ICON[c.kind]} `}${c.name}`, c.unread);
        for (const [nick, p] of app.pms) mk(`pm:${nick}`, `✉ ${nick}`, p.unread);
    }

    const amOp = (c) => app.band || (c && c.names && c.names.some((n) => n.nick === app.me && n.prefix === '@'));
    function drawChan() {
        const key = app.active;
        const c = store(key);
        const isPm = key.startsWith('pm:');
        $('[data-topic]').textContent = isPm ? `Private chat with ${key.slice(3)} · filtered · tap their name to block` : c ? `${c.topic || ''}` : '';
        const room = !isPm && c && c.kind !== 'lobby';
        $('[data-roombar]').hidden = !room;
        $('[data-jam]').hidden = !(room && c.kind === 'jam');
        const showAct = room && ['bobross', 'watch', 'art'].includes(c.kind);
        $('[data-activity]').hidden = !showAct;
        document.body.classList.toggle('am-op', !!(c && amOp(c)));
        if (room) {
            const m = c.modes;
            $('[data-modes]').textContent = `${KIND_NAME[c.kind]} · +t${m.m ? 'm' : ''}${m.i ? 'i' : ''}${m.k ? 'k' : ''}${m.C ? 'C' : ''}${m.Q ? 'Q' : ''}${m.S ? ` slow ${m.S}s` : ''}${m.locked ? ' 🔒' : ''} · ${c.count}/${m.l}`;
            const cam = $('[data-cam]');
            cam.setAttribute('aria-pressed', String(!!c.myCam));
            cam.textContent = c.myCam ? '📷 Camera on' : m.C ? '📷 Camera (18+)' : '📷 Cameras off here';
            cam.disabled = !m.C && !c.myCam;
            if (c.kind === 'jam') {
                const a = $('[data-jam-desktop]');
                const link = c.jam && c.jam.desktop;
                a.hidden = !link; $('[data-jam-wait]').hidden = !!link;
                if (link && /^webjam:\/\//.test(link)) a.setAttribute('href', link);
                const web = $('[data-jam-web]');
                web.disabled = !(c.jam && c.jam.webReady);
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
            b.textContent = `${n.prefix}${n.nick}${n.band ? ' ⭐' : ''}${n.cam ? ' 📷' : ''}${n.away ? ' 💤' : ''}`;
            b.addEventListener('click', () => nickSheet(n.nick));
            li.append(b); ul.append(li);
        });
    }

    function drawRooms() {
        const ul = $('[data-roomlist]');
        ul.replaceChildren();
        $('[data-room-count]').textContent = String(app.rooms.length);
        $('[data-rooms-empty]').hidden = app.rooms.length > 0;
        for (const r of app.rooms) {
            const li = document.createElement('li');
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'room';
            const t = document.createElement('b'); t.textContent = `${KIND_ICON[r.kind]} ${r.title}`;
            const s = document.createElement('span'); s.textContent = `${r.name} · ${r.count}/${r.max}${r.locked ? ' · 🔒 ask the host' : ''}${r.key ? ' · 🔑' : ''}`;
            b.append(t, s);
            b.addEventListener('click', () => {
                if (app.chans.has(r.name)) return switchTo(r.name);
                if (r.key) { const k = prompt(`${r.name} has a key. Type it:`) || ''; return cmd('join', [r.name, k]); }
                return cmd('join', [r.name]);
            });
            li.append(b); ul.append(li);
        }
    }

    // One tap = a room. Name and title are picked for you; the host can /topic later.
    $$('[data-start]').forEach((b) => b.addEventListener('click', () => { count(`room-start-${b.dataset.start}`); cmd('join', [`#${b.dataset.start}-${slug()}`]); }));
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
        ['Cams off', 'mode', null, ['-C']], ['Cams allowed', 'mode', null, ['+C']], ['/topic …', 'topic', 'new topic'], ['🔒 Lock', 'lock'], ['🔓 Unlock', 'lock', null, ['off']], ['Close room', 'close']];
    function openPalette(ops) {
        const box = $('[data-palette-buttons]');
        box.replaceChildren();
        for (const [label, name, ask, fixed] of (ops ? OP_PALETTE : PALETTE)) {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn--small'; b.textContent = label;
            b.addEventListener('click', () => {
                $('[data-palette]').close();
                if (fixed) return cmd(name, fixed);
                if (ask) { const v = prompt(`${label}: ${ask}`); if (v === null) return undefined; return cmd(name, v.trim() ? v.trim().split(' ') : []); }
                return cmd(name, []);
            });
            box.append(b);
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
        input.value = '';
        if (app.active.startsWith('pm:') && !text.startsWith('/')) return cmd('msg', [app.active.slice(3), ...text.split(' ')]);
        return send({ t: 'say', ch: app.active.startsWith('pm:') ? '#stalemate' : app.active, text });
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
    $('[data-jam-form]').addEventListener('submit', (e) => { e.preventDefault(); const v = $('[data-jam-link]').value.trim(); $('[data-jam-link]').value = ''; if (v) cmd('jamlink', [v]); });

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
