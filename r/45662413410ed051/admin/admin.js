/* Band admin panel. Every button sends the same {t:'cmd'} frames as chat; the server re-checks the band role
 * (from the Cloudflare Access JWT) on every one and logs it. textContent only. */
(() => {
    'use strict';
    const $ = (s, el = document) => el.querySelector(s);
    const $$ = (s, el = document) => [...el.querySelectorAll(s)];
    const params = new URLSearchParams(location.search);
    const isLocal = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
    const previewKey = params.get('preview') || sessionStorage.getItem('hangout-preview') || '';
    if (params.get('preview')) sessionStorage.setItem('hangout-preview', params.get('preview'));
    const relayBase = ((isLocal && (params.get('relay') || sessionStorage.getItem('hangout-relay'))) || $('meta[name="hangout-relay"]').content || '').replace(/\/$/, '');
    if (isLocal && params.get('relay')) sessionStorage.setItem('hangout-relay', params.get('relay'));
    const devAdmin = isLocal ? (params.get('devadmin') || sessionStorage.getItem('hangout-devadmin') || '') : ''; // local tests only
    if (devAdmin) sessionStorage.setItem('hangout-devadmin', devAdmin);
    if (location.search) history.replaceState(null, '', location.pathname);
    const status = (t) => { $('[data-status]').textContent = t; };
    // Sign-in hops to the Worker's Access-protected login path, which sends the band member back here.
    $('[data-signin]').href = relayBase ? `${relayBase.replace(/^ws/, 'http')}/lobby-admin/login` : '#';
    if (!previewKey) status('Not open yet.');

    const app = window.__admin = { ws: null, state: null };
    const send = (o) => { if (app.ws && app.ws.readyState === 1) app.ws.send(JSON.stringify(o)); };
    const cmd = (name, args = []) => send({ t: 'cmd', name, args, ch: '#stalemate' });

    $('[data-enter]').addEventListener('click', () => {
        if (!relayBase) return status('The chat server isn’t switched on yet.');
        const q = new URLSearchParams({ preview: previewKey });
        if (devAdmin) q.set('devadmin', devAdmin);
        const dev = localStorage.getItem('hangout-dev');
        if (dev) q.set('dev', dev);
        const ws = new WebSocket(`${relayBase}/lobby-admin?${q}`);
        app.ws = ws;
        let opened = false;
        ws.onopen = () => { opened = true; };
        ws.onclose = () => { if (!opened) status('Not signed in as band. Tap “Sign in with email code” first.'); else toast('Disconnected. Reload to reconnect.'); };
        ws.onmessage = (e) => {
            let m; try { m = JSON.parse(e.data); } catch (err) { return; }
            if (m.t === 'device') localStorage.setItem('hangout-dev', m.token);
            if (m.t === 'hello') send({ t: 'hello', nick: $('[data-nick]').value.trim() || 'Band' });
            if (m.t === 'nick-error') status(m.text);
            if (m.t === 'welcome') { $('[data-gate]').hidden = true; $('[data-panel]').hidden = false; }
            if (m.t === 'admin') { app.state = m.state; draw(); }
            if (m.t === 'notice' && m.kind === 'error') toast(m.text);
            if (m.t === 'denied') toast(m.text);
        };
        return undefined;
    });

    const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
    const btn = (label, fn, cls = 'btn btn--small') => { const b = el('button', label, cls); b.type = 'button'; b.addEventListener('click', fn); return b; };
    const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
    const askReason = (what) => { const r = prompt(`${what}: reason? (required, goes in the mod log)`); return r && r.trim() ? r.trim().split(' ') : null; };

    function draw() {
        const s = app.state;
        $('[data-state]').textContent = `Lobby ${s.lock === 'off' ? 'OPEN' : s.lock === 'readonly' ? (s.lockAuto ? 'READ-ONLY (auto: no band op for 24h)' : 'READ-ONLY') : 'LOCKED'} · Shield ${s.shield ? (s.shieldAuto ? 'UP (auto: no band op for 24h)' : 'UP') : 'down'} · Slow ${s.slow}s · ${s.stats.online} online · Budget ${Math.round(100 * s.budget.requests / s.budget.cap)}% (${s.budget.level})`;
        const reports = $('[data-reports]'); reports.replaceChildren();
        for (const r of s.reports) {
            const li = el('li');
            li.append(el('b', `${r.from} in ${r.ch} · ${r.count} report${r.count > 1 ? 's' : ''}${r.hidden ? ' · auto-hidden' : ''}`), el('span', r.text));
            li.append(el('pre', (r.context || []).join('\n'), 'ctx'));
            const acts = el('div', undefined, 'acts');
            acts.append(btn('Delete', () => cmd('delete', [r.id]), 'btn btn--small'), btn('Mute 1h', () => cmd('mute', [r.from, '1h'])), btn('Kick', () => cmd('kick', [r.from, 'reported'])),
                btn('Ban', () => { const why = askReason(`Ban ${r.from}`); if (why) cmd('gban', [r.from, ...why]); }, 'btn btn--small btn--danger'), btn('Dismiss', () => cmd('dismiss', [r.id]), 'btn btn--small btn--ghost'));
            li.append(acts); reports.append(li);
        }
        const held = $('[data-held]'); held.replaceChildren();
        for (const h of s.held) {
            const li = el('li'); li.append(el('b', `${h.from} in ${h.ch} · ${h.reason}`), el('span', h.text));
            const acts = el('div', undefined, 'acts'); acts.append(btn('OK it', () => cmd('approve', [h.id])), btn('Reject', () => cmd('dismiss', [h.id]), 'btn btn--small btn--ghost'));
            li.append(acts); held.append(li);
        }
        $('[data-qcount]').textContent = s.reports.length + s.held.length ? `(${s.reports.length + s.held.length})` : '';
        $('[data-queue-empty]').hidden = !!(s.reports.length + s.held.length);

        const users = $('[data-users]'); users.replaceChildren();
        for (const u of s.users) {
            const li = el('li'); li.append(el('b', `${u.role !== 'fan' ? '⭐ ' : ''}${u.nick}${u.muted ? ' (muted)' : ''}${u.away ? ' 💤' : ''}`), el('span', u.channels.join(' '), 'small'));
            if (u.role === 'fan') {
                const acts = el('div', undefined, 'acts');
                acts.append(btn('Mute 10m', () => cmd('mute', [u.nick, '10m'])), btn('Mute 24h', () => cmd('mute', [u.nick, '24h'])), btn('Kick', () => cmd('kick', [u.nick, 'take a breather'])),
                    btn('Ban', () => { const why = askReason(`Ban ${u.nick}`); if (why) cmd('gban', [u.nick, ...why]); }, 'btn btn--small btn--danger'), btn('Purge lines', () => cmd('purge', [u.nick]), 'btn btn--small btn--ghost'));
                li.append(acts);
            }
            users.append(li);
        }
        const bans = $('[data-bans]'); bans.replaceChildren();
        const seen = new Set();
        for (const b of s.bans) {
            if (!b.mask.startsWith('nick:') && seen.has(b.nick)) continue;
            if (!b.mask.startsWith('nick:')) continue;
            seen.add(b.nick);
            const li = el('li'); li.append(el('b', `${b.nick || b.mask} · by ${b.by} · ${ago(b.at)}`), el('span', b.reason));
            li.append(btn('Unban', () => cmd('unban', [b.nick || b.mask.slice(5)]), 'btn btn--small btn--ghost')); bans.append(li);
        }
        const rooms = $('[data-rooms]'); rooms.replaceChildren();
        for (const r of s.rooms.filter((x) => x.kind !== 'lobby')) {
            const li = el('li'); li.append(el('b', `${r.title} · ${r.name}`), el('span', `${r.count}/${r.modes.l} · ${r.modes.locked ? 'locked' : 'open'} · cams ${r.modes.C ? 'allowed' : 'off'}`, 'small'));
            const acts = el('div', undefined, 'acts');
            acts.append(btn(r.modes.locked ? 'Unlock' : 'Lock', () => send({ t: 'cmd', name: 'lock', args: [r.name, r.modes.locked ? 'off' : 'on'], ch: r.name })),
                btn('Cams off', () => send({ t: 'cmd', name: 'mode', args: [r.name, '-C'], ch: r.name })), btn('Close', () => send({ t: 'cmd', name: 'close', args: [r.name], ch: r.name }), 'btn btn--small btn--danger'));
            li.append(acts); rooms.append(li);
        }
        drawStats(s.stats);
        const lists = $('[data-lists]'); lists.replaceChildren();
        for (const k of ['block', 'hold', 'allow']) {
            const div = el('div'); div.append(el('h2', `${k} (${s.lists[k].length})`));
            for (const w of s.lists[k]) { const c = el('span', w, 'chip'); c.append(btn('✕', () => cmd('filter', ['del', w]), '')); div.append(c); }
            lists.append(div);
        }
        const log = $('[data-modlog]'); log.replaceChildren();
        for (const e of s.modlog.slice().reverse()) log.append(el('li', `${new Date(e.at).toLocaleString()} · ${e.by} · ${e.action} ${e.target}${e.reason ? ` · ${e.reason}` : ''}${e.ch ? ` · ${e.ch}` : ''}`));
    }

    function bars(box, rows) {
        box.replaceChildren();
        const max = Math.max(1, ...rows.map((r) => r[1]));
        for (const [label, n] of rows) { const row = el('div', undefined, 'bar'); const i = el('i'); i.style.width = `${(100 * n) / max}%`; row.append(el('span', label), i, el('span', String(n))); box.append(row); }
        if (!rows.length) box.append(el('p', 'Nothing yet.', 'small'));
    }
    function drawStats(st) {
        const days = Object.entries(st.days).slice(-14);
        const total = days.reduce((a, [, d]) => a + d.joins, 0);
        const peak = Math.max(0, ...days.map(([, d]) => d.peak));
        const kpis = $('[data-kpis]'); kpis.replaceChildren();
        for (const [label, v] of [['online now', st.online], ['visits (14d)', total], ['peak at once', peak], ['lines (14d)', days.reduce((a, [, d]) => a + d.lines, 0)]]) { const k = el('div', undefined, 'kpi'); k.append(el('b', String(v)), label); kpis.append(k); }
        bars($('[data-days]'), days.map(([d, v]) => [d.slice(5), v.joins]));
        // UTC hour buckets -> the viewer's local hours.
        const offset = -new Date().getTimezoneOffset() / 60;
        const local = Array.from({ length: 24 }, (_, h) => st.byHourOfDayUTC[((h - offset) % 24 + 24) % 24] || 0);
        const hours = $('[data-hours]'); hours.replaceChildren();
        const hmax = Math.max(1, ...local);
        local.forEach((n, h) => { const c = el('div', undefined, 'col'); c.style.height = `${(100 * n) / hmax}%`; c.title = `${h}:00 · ${n}`; if (h % 6 === 0) c.append(el('span', `${h}h`)); hours.append(c); });
        const names = { bobross: '🎨 Bob Ross', watch: '📺 Watch', art: '🖌️ Art', jam: '🎸 Jam' };
        bars($('[data-kinds]'), Object.entries(st.kinds).map(([k, n]) => [names[k] || k, n]));
        const busiest = $('[data-busiest]'); busiest.replaceChildren();
        for (const [name, n] of st.busiestRooms) busiest.append(el('li', `${name} · ${n} joins`));
        const mod = $('[data-modsum]'); mod.replaceChildren();
        const filterHits = Object.entries(st.mod).filter(([k]) => k.startsWith('filter:')).reduce((a, [, n]) => a + n, 0);
        for (const [label, v] of [['filter blocks', filterHits], ['held for review', st.mod['filter-hold'] || 0], ['kicks', st.mod.kick || 0], ['bans', st.mod.ban || 0], ['mutes', st.mod.mute || 0], ['reports made', st.reports.made], ['auto-hidden', st.reports.autoHidden], ['acted on', st.reports.actioned], ['dismissed', st.reports.dismissed], ['blocked op attempts', st.mod.denied || 0]]) {
            const k = el('div', undefined, 'kpi'); k.append(el('b', String(v)), label); mod.append(k);
        }
    }

    $('[data-panic]').addEventListener('click', () => { if (confirm('Raise the shield? Slow mode 30s, all cameras off, no new rooms or PM requests.')) cmd('shield'); });
    $('[data-shieldoff]').addEventListener('click', () => cmd('shieldoff'));
    $$('[data-lobby]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.lobby !== 'lock' || confirm('Lock the lobby? Fans get “back soon” and are disconnected.')) cmd('lobby', [b.dataset.lobby]); }));
    $$('[data-slow]').forEach((b) => b.addEventListener('click', () => cmd('slow', [b.dataset.slow])));
    $('[data-camoff]').addEventListener('click', () => cmd('camoff', ['all']));
    let filterList = 'block';
    $$('[data-filter-form] button').forEach((b) => b.addEventListener('click', () => { filterList = b.value; }));
    $('[data-filter-form]').addEventListener('submit', (e) => { e.preventDefault(); const w = $('[data-filter-word]').value.trim(); if (w) cmd('filter', [filterList, w]); $('[data-filter-word]').value = ''; });
    $$('[data-tab]').forEach((b) => b.addEventListener('click', () => {
        $$('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
        $$('[data-view]').forEach((v) => { v.hidden = v.dataset.view !== b.dataset.tab; });
    }));
    let tt;
    function toast(text) { const t = $('[data-toast]'); t.textContent = text; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => { t.hidden = true; }, 4000); }
})();
