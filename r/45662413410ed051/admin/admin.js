/* Band admin panel. Every button sends the same {t:'cmd'} frames as chat; the server re-checks the band role
 * (from the Cloudflare Access JWT) on every one and logs it. textContent only. */
(() => {
    'use strict';
    const $ = (s, el = document) => el.querySelector(s);
    const $$ = (s, el = document) => [...el.querySelectorAll(s)];
    const params = new URLSearchParams(location.search);
    const resumeSignin = params.get('signed-in') === '1';
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
    const cmd = (name, args = []) => { if (app.state) send({ t: 'cmd', name, args, ch: '#stalemate' }); };

    function clearPanel() {
        app.state = null;
        // Hide and erase received evidence when its authenticated connection
        // ends. A hidden panel must not retain private report text or actions.
        for (const selector of ['[data-reports]', '[data-held]', '[data-ai-reviews]', '[data-private-reports]',
            '[data-users]', '[data-bans]', '[data-rooms]', '[data-modlog]']) $(selector).replaceChildren();
        for (const selector of ['[data-state]', '[data-qcount]', '[data-ai-counts]', '[data-private-report-storage]']) $(selector).textContent = '';
        $('[data-private-report-review]').hidden = true;
        $('[data-panel]').hidden = true;
        $('[data-gate]').hidden = false;
    }

    function connectPanel() {
        if (!relayBase) return status('The chat server isn’t switched on yet.');
        const q = new URLSearchParams({ preview: previewKey });
        if (devAdmin) q.set('devadmin', devAdmin);
        const dev = localStorage.getItem('hangout-dev');
        if (dev) q.set('dev', dev);
        const previous = app.ws;
        const ws = new WebSocket(`${relayBase}/lobby-admin?${q}`);
        app.ws = ws;
        clearPanel();
        status('Connecting to the moderation panel…');
        if (previous && previous.readyState < 2) previous.close(1000, 'staff connection replaced');
        let opened = false;
        let timedOut = false;
        const deadline = setTimeout(() => {
            if (app.ws !== ws) return;
            timedOut = true;
            ws.close(1000, 'staff connection timed out');
        }, 12000);
        ws.onopen = () => { if (app.ws === ws) opened = true; };
        ws.onclose = (event) => {
            clearTimeout(deadline);
            if (app.ws !== ws) return;
            app.ws = null;
            clearPanel();
            const message = timedOut ? 'The panel didn’t respond. Try “Open the panel” again. If it keeps happening, check your connection.' : !opened
                ? 'Not signed in as a site moderator. Tap “Sign in with email code” first.'
                : event.code === 4401 ? 'Staff session ended. Tap “Sign in with email code”, then reconnect.'
                    : 'Disconnected. Reconnect to load the current review queue.';
            status(message); toast(message);
            $(timedOut ? '[data-enter]' : '[data-signin]').focus({ preventScroll: true });
        };
        ws.onmessage = (e) => {
            if (app.ws !== ws || ws.readyState !== 1) return;
            let m; try { m = JSON.parse(e.data); } catch (err) { return; }
            if (m.t === 'device') localStorage.setItem('hangout-dev', m.token);
            if (m.t === 'hello') send({ t: 'hello', nick: $('[data-nick]').value.trim() || 'Helper', age13: true });
            if (m.t === 'nick-error') status(m.text);
            if (m.t === 'welcome') status('Loading the review queue…');
            if (m.t === 'admin') { app.state = m.state; draw(); clearTimeout(deadline); status('Connected.'); $('[data-gate]').hidden = true; $('[data-panel]').hidden = false; }
            if (m.t === 'notice' && m.kind === 'error') toast(m.text);
            if (m.t === 'rate-limit') toast(m.text);
            if (m.t === 'denied') toast(m.text);
        };
        return undefined;
    }
    $('[data-enter]').addEventListener('click', connectPanel);

    const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
    const btn = (label, fn, cls = 'btn btn--small') => { const b = el('button', label, cls); b.type = 'button'; b.addEventListener('click', fn); return b; };
    const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
    const askReason = (what) => { const r = prompt(`${what}: reason? (required, goes in the mod log)`); return r && r.trim() ? r.trim().split(' ') : null; };

    function drawAiReview(s) {
        const ai = s.aiModeration || {};
        $('[data-moderation-storage]').hidden = ai.evidenceStorage !== 'degraded';
        const state = typeof ai.state === 'string'
            ? ai.state === 'ready' && ai.enabled !== true ? 'unknown' : ai.state
            : ai.enabled === true ? 'unknown' : 'disabled';
        const labels = {
            disabled: 'AI review is off',
            'not-qualified': 'AI review is paused · privacy and provider readiness need qualification',
            ready: 'AI review is ready · review only',
            degraded: 'AI review is interrupted · some messages may be unchecked',
            capped: 'AI review reached its usage limit · further checks are paused',
            misconfigured: 'AI review needs server configuration · checks are unavailable'
        };
        const statusLine = $('[data-ai-state]');
        const knownState = typeof state === 'string' && Object.prototype.hasOwnProperty.call(labels, state);
        statusLine.textContent = knownState ? labels[state] : 'AI review status is unavailable';
        statusLine.dataset.aiHealth = knownState ? state : 'unknown';
        const count = (key) => Number.isSafeInteger(ai[key]) && ai[key] >= 0 ? String(ai[key]) : '—';
        $('[data-ai-counts]').textContent = ai.enabled === true
            ? `Checked ${count('checked')} · Flagged ${count('flagged')} · Failed ${count('failed')} · Skipped ${count('skipped')} · Pending ${count('pending')} · Usage ${count('used')}/${count('limit')}`
            : 'Ordinary filters and visitor reports remain available.';
        const reviews = Array.isArray(s.aiReviews) ? s.aiReviews.filter((r) => r && typeof r.id === 'string' && typeof r.text === 'string') : [];
        const list = $('[data-ai-reviews]');
        const focused = list.contains(document.activeElement) ? document.activeElement : null;
        const focusId = focused?.closest('[data-ai-review-id]')?.dataset.aiReviewId;
        const focusAction = focused?.dataset.aiAction;
        list.replaceChildren();
        for (const review of reviews) {
            const li = el('li');
            li.dataset.aiReviewId = review.id;
            li.append(el('b', `${review.from || 'Unknown nickname'} in ${review.ch || 'Unknown channel'}`));
            const timestamp = Number.isFinite(review.at) ? new Date(review.at).toLocaleString() : 'Time unavailable';
            li.append(el('span', `${timestamp} · Model: ${typeof review.model === 'string' && review.model ? review.model : 'Unspecified'}`, 'small'));
            li.append(el('p', review.text, 'ai-evidence'));
            const categories = Array.isArray(review.categories) ? review.categories.filter((c) => typeof c === 'string' && c) : [];
            li.append(el('span', `Signals: ${categories.length ? categories.join(', ') : 'No category supplied'}`, 'small ai-signals'));
            const acts = el('div', undefined, 'acts');
            for (const [label, action] of [['Delete message', 'delete'], ['Dismiss signal', 'aidismiss']]) {
                const button = btn(label, () => cmd(action, [review.id]), action === 'delete' ? 'btn btn--small' : 'btn btn--small btn--ghost');
                button.dataset.aiAction = action;
                acts.append(button);
            }
            li.append(acts); list.append(li);
        }
        // Incoming status snapshots must not strand a keyboard reviewer halfway through an action.
        if (focusId && focusAction) {
            const replacement = $$('[data-ai-review-id]', list).find((li) => li.dataset.aiReviewId === focusId);
            const button = replacement && $$('[data-ai-action]', replacement).find((b) => b.dataset.aiAction === focusAction);
            (button || statusLine).focus({ preventScroll: true });
        }
        $('[data-ai-empty]').hidden = reviews.length > 0;
        return reviews.length;
    }

    function drawPrivateReports(s) {
        const review = $('[data-private-report-review]');
        const queue = s.privateReports;
        review.hidden = !queue;
        if (!queue) return 0;
        const ready = queue.storage === 'ready';
        const line = $('[data-private-report-storage]');
        line.textContent = ready ? 'Private report storage is ready. Review each claim before taking any separate action.'
            : 'Private report storage is unavailable. Evidence and review actions are not confirmed; check storage before relying on this queue.';
        const list = $('[data-private-reports]');
        const focused = list.contains(document.activeElement) ? document.activeElement : null;
        const focusId = focused?.closest('[data-private-report-id]')?.dataset.privateReportId;
        const focusAction = focused?.dataset.privateReportAction;
        list.replaceChildren();
        const reports = Array.isArray(queue.reports) ? queue.reports.filter(r => r && typeof r.id === 'string') : [];
        for (const report of reports) {
            const li = el('li'); li.dataset.privateReportId = report.id;
            li.append(el('b', `Reported nickname: ${report.claimedName || 'Not supplied'} · ${report.kind === 'message' ? 'Shared quote' : 'Member concern'}`));
            const at = Number.isFinite(report.at) ? new Date(report.at).toLocaleString() : 'Time unavailable';
            li.append(el('span', `${at} · Room reference ${String(report.roomRef || '').slice(0, 10)}`, 'small'));
            li.append(el('p', 'Reporter-supplied evidence · quote not independently verified', 'small'));
            li.append(el('p', report.targetMembership === 'live'
                ? 'The server confirmed the reported relay connection was in this room at submission. This does not verify the quote or nickname.'
                : 'The reported connection was absent or unverified at submission. Do not identify or punish someone by the retained nickname.', 'small'));
            if (typeof report.excerpt === 'string' && report.excerpt) li.append(el('pre', report.excerpt, 'ctx'));
            if (typeof report.reason === 'string' && report.reason) li.append(el('p', report.reason));
            const acts = el('div', undefined, 'acts');
            for (const [label, action] of [['Resolve report', 'resolve'], ['Dismiss report', 'dismiss']]) {
                const button = btn(label, () => cmd('privatereport', [action, report.id]), action === 'dismiss' ? 'btn btn--small btn--ghost' : 'btn btn--small');
                button.dataset.privateReportAction = action; button.disabled = !ready;
                acts.append(button);
            }
            li.append(acts); list.append(li);
        }
        if (focusId && focusAction) {
            const row = $$('[data-private-report-id]', list).find(li => li.dataset.privateReportId === focusId);
            const replacement = row && $$('[data-private-report-action]', row).find(button => button.dataset.privateReportAction === focusAction);
            (replacement && !replacement.disabled ? replacement : line).focus({ preventScroll: true });
        }
        return reports.length;
    }

    function draw() {
        const configure = app.state?.capabilities?.configure === true;
        $$('[data-panic], [data-shieldoff], [data-lobby], [data-slow], [data-tab=filter], [data-filter-form]').forEach((e) => { e.hidden = !configure; });
        const s = app.state;
        $('[data-state]').textContent = `Lobby ${s.lock === 'off' ? 'OPEN' : s.lock === 'readonly' ? (s.lockAuto ? 'READ-ONLY (automatic safety lock)' : 'READ-ONLY') : 'LOCKED'} · Shield ${s.shield ? (s.shieldAuto ? 'UP (legacy automatic shield)' : 'UP') : 'down'} · Slow ${s.slow}s · ${s.stats.online} online · Budget ${Math.round(100 * s.budget.requests / s.budget.cap)}% (${s.budget.level})`;
        const aiReviewCount = drawAiReview(s);
        const privateReportCount = drawPrivateReports(s);
        const reports = $('[data-reports]'); reports.replaceChildren();
        for (const r of s.reports) {
            const li = el('li');
            li.append(el('b', `${r.from} in ${r.ch} · ${r.count} report${r.count > 1 ? 's' : ''}${r.hidden ? ' · auto-hidden' : ''}`), el('span', r.text));
            li.append(el('pre', (r.context || []).join('\n'), 'ctx'));
            const acts = el('div', undefined, 'acts');
            // Retained nicknames can belong to a different person later. Evidence actions target the message only.
            acts.append(btn('Delete', () => cmd('delete', [r.id]), 'btn btn--small'), btn('Dismiss', () => cmd('dismiss', [r.id]), 'btn btn--small btn--ghost'));
            li.append(acts); reports.append(li);
        }
        const held = $('[data-held]'); held.replaceChildren();
        for (const h of s.held) {
            const li = el('li'); li.append(el('b', `${h.from} in ${h.ch} · ${h.reason}`), el('span', h.text));
            const acts = el('div', undefined, 'acts'); acts.append(btn('OK it', () => cmd('approve', [h.id])), btn('Reject', () => cmd('dismiss', [h.id]), 'btn btn--small btn--ghost'));
            li.append(acts); held.append(li);
        }
        const queueCount = s.reports.length + s.held.length + aiReviewCount + privateReportCount;
        $('[data-qcount]').textContent = queueCount ? `(${queueCount})` : '';
        $('[data-queue-empty]').hidden = !!queueCount;

        const users = $('[data-users]'); users.replaceChildren();
        for (const u of s.users) {
            const li = el('li'); li.append(el('b', `${u.role === 'moderator' ? 'MOD ' : u.role !== 'fan' ? '⭐ ' : ''}${u.nick}${u.muted ? ' (muted)' : ''}${u.away ? ' 💤' : ''}`), el('span', u.channels.join(' '), 'small'));
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
    // This is a navigation hint, never an identity assertion. The server still
    // verifies the invitation session and staff Access JWT on the new socket.
    if (resumeSignin) connectPanel();
})();
