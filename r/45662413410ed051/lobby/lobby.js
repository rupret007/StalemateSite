/* #stalemate lobby client. Hidden preview. Everything is rendered with textContent;
 * the server enforces permissions, rate limits and public-content policies. */
import * as entrance from '../entry-sites.mjs';
import { createChatAnnouncements } from './chat-announcements.mjs';
import { createEntrySharing } from './entry-sharing.mjs';
import { createIdleHeartbeat } from './idle-heartbeat.mjs';
import { discordCallLink, FOUR_COLUMNS, FOUR_ROWS, fourFinished, fourMark, fourWinningCells, gameInviteCode, gameNightInvite, gameNightLabels, gameNightRoomName, newGameNightRoomName } from './game-night.mjs';
(() => {
    'use strict';
    const { createEntrySiteRegistry, entryBadge, entryReturn, entrySourceFromParams, ENTRY_HANDOFF_KEY, entryHandoff,
        readEntryHandoff, KEEP_ROOM_INTENT_KEY, KEEP_ROOM_INTENT_TTL, keepRoomIntent, readKeepRoomIntent, consumeKeepRoomIntent,
        GAME_NIGHT_QUERY, gameNightEntry, gameNightFragment } = entrance;
    const $ = (s, el = document) => el.querySelector(s);
    const $$ = (s, el = document) => [...el.querySelectorAll(s)];
    const fullscreenButton = $('[data-fullscreen]');
    if (fullscreenButton && document.fullscreenEnabled && document.documentElement.requestFullscreen) {
        fullscreenButton.hidden = false;
        const reflectFullscreen = () => {
            const active = document.fullscreenElement === document.documentElement;
            fullscreenButton.textContent = active ? 'Exit full screen' : 'Full screen';
            fullscreenButton.setAttribute('aria-pressed', String(active));
        };
        document.addEventListener('fullscreenchange', reflectFullscreen);
        fullscreenButton.addEventListener('click', async () => {
            try {
                if (document.fullscreenElement === document.documentElement) await document.exitFullscreen();
                else await document.documentElement.requestFullscreen();
            } catch {
                toast('Full screen is unavailable here. Maximize this browser window to use more space.');
            } finally { reflectFullscreen(); }
        });
    }
    const Discovery = window.HangoutDiscovery;
    const params = new URLSearchParams(location.search);
    const readTab = key => { try { return sessionStorage.getItem(key); } catch { return null; } };
    const writeTab = (key, value) => { try { sessionStorage.setItem(key, value); } catch { /* Tab storage is optional for ordinary chat. */ } };
    const removeTab = key => { try { sessionStorage.removeItem(key); } catch { /* A failed Keep read is handled separately. */ } };
    const readRemembered = key => { try { return localStorage.getItem(key); } catch { return null; } };
    const writeRemembered = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Remembering this device is optional. */ } };
    // Only the protected shell adds this marker. Its current display/admission
    // hints also live in memory, independent of optional tab storage.
    const betaShell = !!$('script[src="/beta/bootstrap.js"], script[src="/beta/bootstrap.js?game-guest=1"]');
    const betaBootstrap = betaShell && window.HangoutBootstrap;
    const gameGuest = betaBootstrap?.gameGuest;
    const gameGuestQuery = gameGuest ? '?game-guest=1' : '';
    const guestInvitationChanged = gameGuest && history.state?.gameSessionRef && history.state.gameSessionRef !== gameGuest.sessionRef;
    let gameGuestExit = gameGuest && ['left', 'canceled', 'closed', 'removed'].includes(history.state?.gameExit) ? history.state.gameExit : '';
    let gameGuestSeated = false, gameGuestReloadOffered = false;
    if (gameGuest) {
        document.body.classList.add('game-guest');
        if (gameGuest.game === 'four') document.body.classList.add('game-guest-four');
    }
    let gameEntry = betaShell ? gameNightEntry?.(params, location.hash) : null;

    const entrySites = createEntrySiteRegistry(window.HangoutEntrySites);
    const ARCADE_RESUME_KEY = 'hangout-arcade-resume';
    const savedArcade = readTab(ARCADE_RESUME_KEY);
    removeTab(ARCADE_RESUME_KEY);
    let arcadeResume = null, resumeEntry = null;
    if (betaShell && !gameGuest && typeof savedArcade === 'string' && savedArcade.length <= 512
        && !gameEntry && !params.has('via') && !location.hash && performance.getEntriesByType?.('navigation')[0]?.type === 'reload') {
        try {
            const saved = JSON.parse(savedArcade);
            const intent = readKeepRoomIntent(saved?.intent);
            if (intent && gameNightRoomName(intent.room)) {
                arcadeResume = { ...intent, game: typeof saved.game === 'string' ? saved.game : 'chess' };
                resumeEntry = readEntryHandoff(saved.entry, Date.now(), entrySites);
            }
        } catch { /* Tab state only restores navigation; the server authorizes entry. */ }
    }
    let handoff = null;
    try {
        if (params.get('entry-return') === '1') handoff = readEntryHandoff(sessionStorage.getItem(ENTRY_HANDOFF_KEY), Date.now(), entrySites);
        sessionStorage.removeItem(ENTRY_HANDOFF_KEY);
    } catch { /* A blocked tab store must not prevent ordinary chat. */ }
    const entrySource = params.has('via') ? entrySourceFromParams(params, entrySites) : handoff?.source || resumeEntry?.source || '';
    const gameArcadeBrand = entrySource === 'rad-dad' ? entrySites['rad-dad'] : entrySites.stalemate;
    $('[data-game-arcade]').href = new URL('play/', gameArcadeBrand.home).href;
    $('[data-game-arcade-label]').textContent = `Open ${gameArcadeBrand.label} Arcade`;
    let shareEntry = (handoff || resumeEntry)?.share !== false;
    let entrySourcesSupported = null;
    let privateMessageContextSupported = false, privateMessagePeersSupported = false, personTargetsSupported = false;
    let paletteContext = null;
    let keepSupported = false, keepReturnChecked = false, pendingKeep = null, keepTimer;
    // With an older server, only commands with an explicit target or global
    // meaning are safe in a private tab. Its channel fallback cannot route PM
    // actions, so refuse them locally without clearing the visitor's draft.
    const legacyPrivateCommands = new Set(['join', 'j', 'quit', 'exit', 'bye', 'nick', 'msg', 'm', 'query', 'q', 'whois', 'w', 'who',
        'away', 'ignore', 'unignore', 'list', 'help', 'h', '?', 'accept', 'decline', 'deny', 'block', 'unblock', 'pm',
        'mute', 'gban', 'purge', 'shield', 'shieldoff', 'lobby', 'filter', 'slow', 'approve', 'approveheld',
        'dismiss', 'aidismiss', 'privatereport', 'log', 'delete']);
    let ownerSession = !gameGuest && (params.get('owner') === '1' || (betaBootstrap ? betaBootstrap.owner === true : readTab('hangout-owner') === '1'));
    if (ownerSession) writeTab('hangout-owner', '1');
    const isLocal = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
    // Read the preview key once, then drop the query from the address bar (keeps it out of history,
    // screenshots and page analytics).
    const previewKey = params.get('preview') || (typeof betaBootstrap?.preview === 'string' ? betaBootstrap.preview : '') || readTab('hangout-preview') || '';
    if (params.get('preview')) writeTab('hangout-preview', params.get('preview'));
    const relayBase = ((isLocal && (params.get('relay') || readTab('hangout-relay'))) || $('meta[name="hangout-relay"]').content || '').replace(/\/$/, '');
    const turnUrl = ((isLocal && params.get('turn')) || $('meta[name="hangout-turn"]').content || '').trim();
    if (isLocal && params.get('relay')) writeTab('hangout-relay', params.get('relay'));
    if (location.search) history.replaceState(gameGuest ? { gameSessionRef: history.state?.gameSessionRef || gameGuest.sessionRef, gameExit: gameGuestExit } : null, '', location.pathname + gameGuestQuery + location.hash);
    const siteKey = $('meta[name="hangout-turnstile"]').content || '';
    const inviteHash = new URLSearchParams(location.hash.slice(1));
    const pendingRoomFromInvite = gameEntry ? '' : inviteHash.get('room') || '';
    if (pendingRoomFromInvite || gameEntry) history.replaceState(null, '', location.pathname + gameGuestQuery);

    // GoatCounter: fixed, privacy-safe event names only (no nicks, no room names, no query string).
    const count = (event) => { try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: `hangout-${event}`, title: 'Hang Out', event: true, referrer: '' }); } catch (e) { /* analytics never breaks chat */ } };
    count('lobby-view');
    const KIND_ICON = { lobby: '#', chat: '#', bobross: '🎨', watch: '📺', art: '🖌️', jam: '🎸', game: '🎮' };
    const KIND_NAME = { chat: 'Chat channel', bobross: 'Bob Ross paint-along', watch: 'Watch together', art: 'Draw together', jam: 'Jam', game: 'Game Night' };
    const WORDS = ['happy', 'little', 'gross', 'loud', 'feral', 'fuzzy', 'mighty', 'snotty', 'rad', 'grumpy', 'soggy', 'mosh'];
    const THINGS = ['tree', 'cloud', 'possum', 'riff', 'taco', 'goat', 'ghost', 'drip', 'squirrel', 'pickle', 'van', 'amp'];
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const slug = () => `${pick(WORDS)}-${pick(THINGS)}`.replace(/[^a-z0-9-]/g, '');

    const app = window.__lobby = { ws: null, me: '', role: 'fan', band: false, chans: new Map(), pms: new Map(), active: '#stalemate', rooms: [], ignores: new Set(), peerIgnores: new Set(), selfId: '', pending: null, confirmedGathering: null, approvedCreation: null, pendingRoomJoin: pendingRoomFromInvite || '' };
    // Same words as REPORT_QUEUED_LABEL in the lobby engine. This page does not
    // import that engine. A queued flag is not proof a moderator is reading it.
    const REPORT_QUEUED_LABEL = 'Queued for review when a moderator is available';
    // Copies are tab memory only. Weak context IDs do not retain a departed
    // room's transcript, and no copy or nonce enters browser storage/analytics.
    const savedMessages = new Map();
    const recoveryContexts = new WeakMap(), recoveryDrafts = new WeakMap();
    let nextRecoveryContext = 0, recoveryBytes = 2, messageEpoch = 0, recoveryLifecycle = 0;
    let messageResultsSupported = false, copyingMessage = null;
    function recoveryContext() {
        const view = store(app.active);
        if (!view) return null;
        if (!recoveryContexts.has(view)) recoveryContexts.set(view, ++nextRecoveryContext);
        return { key: app.active, context: recoveryContexts.get(view), revision: recoveryDrafts.get(view) || 0 };
    }
    function recoveryDraftChanged() {
        const view = store(app.active);
        if (view) recoveryDrafts.set(view, (recoveryDrafts.get(view) || 0) + 1);
        drawMessageRecovery();
    }
    function canRestoreMessage(record) {
        const current = recoveryContext();
        return connectionState === 'connected' && !sessionEnded && !app.localMediaPaused && !app.sharingStopped
            && record.status !== 'waiting' && record.epoch === messageEpoch && current
            && current.key === record.key && current.context === record.context && current.revision === record.revision
            && (!record.key.startsWith('pm:') || store(record.key)?.open === true && privateMessagePeersSupported) && !$('[data-text]').value;
    }
    function forgetSavedMessage(record) {
        if (savedMessages.get(record.id) !== record) return;
        clearTimeout(record.timer); savedMessages.delete(record.id); recoveryBytes -= record.bytes;
        if (copyingMessage === record.id) closeMessageCopy();
        drawMessageRecovery();
    }
    function closeMessageCopy() {
        const dialog = $('[data-message-copy]'), id = copyingMessage;
        const restore = dialog.contains(document.activeElement) || id && document.activeElement === document.body;
        copyingMessage = null; $('[data-message-copy-text]').value = ''; $('[data-message-copy-label]').textContent = '';
        if (dialog.open) dialog.close();
        if (restore) {
            const row = [...$('[data-message-recovery-list]').children].find(node => node.dataset.messageId === id);
            const copy = savedMessages.has(id) && row?.querySelector('[data-message-action="copy"]');
            const target = [copy, $('[data-text]'), $('[data-reconnect]'), $('[data-sharing-leave]')]
                .find(node => node && !node.disabled && !node.closest('[hidden]') && getComputedStyle(node).display !== 'none');
            target?.focus({ preventScroll: true });
        }
    }
    function clearMessageRecovery() {
        recoveryLifecycle++; messageEpoch++;
        for (const record of savedMessages.values()) clearTimeout(record.timer);
        savedMessages.clear(); recoveryBytes = 2; closeMessageCopy(); drawMessageRecovery();
    }
    function messageTarget(record) { return record.key.startsWith('pm:') ? `PM with ${store(record.key)?.nick || record.targetLabel || 'this visitor'}` : record.key; }
    async function copySavedMessage(record) {
        if (savedMessages.get(record.id) !== record) return;
        const lifecycle = recoveryLifecycle;
        try {
            if (!navigator.clipboard?.writeText) throw Error('manual-copy');
            await navigator.clipboard.writeText(record.text);
            if (lifecycle === recoveryLifecycle && savedMessages.get(record.id) === record) toast('Saved text copied. Nothing was sent again.');
        } catch {
            // An auth/session change during clipboard work must not revive its
            // private fallback text in a later visitor's admitted session.
            if (lifecycle !== recoveryLifecycle || savedMessages.get(record.id) !== record) return;
            copyingMessage = record.id;
            $('[data-message-copy-label]').textContent = `Saved locally for ${messageTarget(record)}. It may already have arrived.`;
            $('[data-message-copy-text]').value = record.text;
            $('[data-message-copy]').showModal(); $('[data-message-copy-text]').focus(); $('[data-message-copy-text]').select();
        }
    }
    function drawMessageRecovery() {
        const region = $('[data-message-recovery]'), list = $('[data-message-recovery-list]');
        const focused = region.contains(document.activeElement) ? {
            id: document.activeElement.closest('[data-message-id]')?.dataset.messageId,
            action: document.activeElement.dataset.messageAction
        } : null;
        region.hidden = savedMessages.size === 0; $('.chat').classList.toggle('has-saved-messages', savedMessages.size > 0); list.replaceChildren();
        const counts = ['waiting', 'rejected', 'held', 'pending', 'uncertain'].flatMap(status => {
            const count = [...savedMessages.values()].filter(record => record.status === status).length;
            return count ? [`${count} ${{ waiting: 'awaiting result', rejected: 'not sent', held: 'held for review', pending: 'PM request pending', uncertain: 'unconfirmed' }[status]}`] : [];
        });
        const summary = savedMessages.size ? `${savedMessages.size} saved message ${savedMessages.size === 1 ? 'copy' : 'copies'}: ${counts.join(', ')}. `
            + (connectionState === 'offline' ? 'A message may have arrived. Copy or discard it before choosing Try again; reconnecting clears these copies.' : 'Only in this tab. Restore never sends automatically.') : '';
        if ($('[data-message-recovery-status]').textContent !== summary) $('[data-message-recovery-status]').textContent = summary;
        const context = recoveryContext();
        for (const record of savedMessages.values()) {
            const row = document.createElement('li'); row.dataset.messageId = record.id;
            const label = document.createElement('p');
            const status = { waiting: 'Waiting for the server result.', rejected: 'Message was not sent.', held: 'Held for moderator review instead of publishing. It may be approved later.',
                pending: 'PM request queued instead of delivering. It may arrive after acceptance.', uncertain: record.legacy ? 'This server cannot confirm this send. It may have arrived.' : 'Send result is unconfirmed. It may have arrived.' }[record.status];
            label.textContent = `${messageTarget(record)} — ${status}`; row.append(label);
            if (record.epoch === messageEpoch && context?.key === record.key && context.context === record.context) {
                const text = document.createElement('p'); text.className = 'saved-message-text'; text.textContent = record.text; row.append(text);
            }
            const actions = document.createElement('div'); actions.className = 'saved-message-actions';
            const button = (label, action, fn) => {
                const control = document.createElement('button'); control.type = 'button'; control.className = 'btn btn--small';
                control.dataset.messageAction = action; control.textContent = label; control.addEventListener('click', fn); actions.append(control); return control;
            };
            button('Restore draft', 'restore', () => {
                if (!canRestoreMessage(record)) return;
                if (record.status !== 'rejected' && !confirm('This message may still arrive or be published. Restoring can create a duplicate if you send it again, and does not cancel the original. Restore the draft?')) return;
                $('[data-text]').value = record.text; drafts.set(record.key, record.text);
                recoveryDraftChanged(); forgetSavedMessage(record); $('[data-text]').focus({ preventScroll: true });
            }).disabled = !canRestoreMessage(record);
            button('Copy', 'copy', () => copySavedMessage(record)).setAttribute('aria-label', 'Copy saved text');
            button('Discard', 'discard', () => forgetSavedMessage(record)).setAttribute('aria-label', 'Discard saved copy');
            row.append(actions); list.append(row);
        }
        if (focused) {
            const row = [...list.children].find(node => node.dataset.messageId === focused.id);
            const target = row?.querySelector(`[data-message-action="${focused.action}"]`);
            if (target && !target.disabled) target.focus({ preventScroll: true });
            else {
                const fallback = [$('[data-text]'), $('[data-reconnect]'), $('[data-sharing-leave]')]
                    .find(node => node && !node.disabled && !node.closest('[hidden]') && getComputedStyle(node).display !== 'none');
                fallback?.focus({ preventScroll: true });
            }
        }
    }
    function rememberMessage(text) {
        const context = recoveryContext();
        if (!context || text.length > 300) { toast('Keep this draft under 300 characters and choose its conversation first.'); return null; }
        const token = [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        const record = { id: token, text, ...context, ...(app.active.startsWith('pm:') ? { targetLabel: store(app.active)?.nick || 'this visitor' } : {}), epoch: messageEpoch, legacy: !messageResultsSupported, status: messageResultsSupported ? 'waiting' : 'uncertain' };
        // Conservative metadata/status/timer allowance plus exact UTF-8 text.
        record.bytes = new Blob([JSON.stringify(record)]).size + 64;
        if (savedMessages.size >= 8 || recoveryBytes + record.bytes > 12 * 1024) {
            toast('Saved message copies are full. Copy or discard an earlier one first. Your current draft stays here.'); return null;
        }
        savedMessages.set(token, record); recoveryBytes += record.bytes;
        if (!record.legacy) record.timer = setTimeout(() => {
            if (savedMessages.get(token) === record && record.status === 'waiting') { record.status = 'uncertain'; drawMessageRecovery(); }
        }, 10000);
        drawMessageRecovery(); return record;
    }
    function messageResult(frame) {
        if (!messageResultsSupported || !['published', 'held', 'pending', 'rejected'].includes(frame.status)
            || Object.keys(frame).some(key => !['t', 'id', 'status', 'transportSeq'].includes(key))) return;
        const record = savedMessages.get(frame.id);
        if (!record || record.epoch !== messageEpoch || record.status !== 'waiting' || record.legacy) return;
        clearTimeout(record.timer);
        if (frame.status === 'published') forgetSavedMessage(record);
        else { record.status = frame.status; drawMessageRecovery(); }
    }
    function uncertainMessages() {
        for (const record of savedMessages.values()) if (record.status === 'waiting') { clearTimeout(record.timer); record.status = 'uncertain'; }
        drawMessageRecovery();
    }
    $('[data-text]').addEventListener('input', recoveryDraftChanged);
    $('[data-message-copy-close]').addEventListener('click', closeMessageCopy);
    $('[data-message-copy]').addEventListener('close', () => {
        // A native close event can be queued until after another copy opens.
        // An old event must not close/clear that newer dialog.
        if (!$('[data-message-copy]').open) closeMessageCopy();
    });
    window.addEventListener('pagehide', clearMessageRecovery);
    const sharingControls = betaShell && window.HangoutParticipationControls === true;
    let sharingState = null, sharingBusy = false, sharingCleanup = 'unknown', sharingConfirmation = 0;
    const sharingRegion = $('[data-sharing-region]');
    const sharingStatus = text => { $('[data-sharing-status]').textContent = text; };
    function closeSharingConfirm() {
        const focused = $('[data-sharing-confirm]').contains(document.activeElement);
        $('[data-sharing-confirm]').hidden = true;
        if (focused) $('[data-sharing-stop]').focus({ preventScroll: true });
    }
    function drawSharing(value) {
        sharingState = value;
        $('[data-sharing-leave]').disabled = sessionEnded || !app.me || app.ws?.readyState !== 1;
        if (value.state !== 'withdrawn') sharingCleanup = 'unknown';
        else if (value.cleanup === 'confirmed') sharingCleanup = 'confirmed';
        else if (value.cleanup === 'unconfirmed') sharingCleanup = 'unconfirmed';
        const labels = { authorized: 'Sharing is available for the approved purposes shown below.', withdrawn: app.me && app.ws?.readyState === 1 ? 'Sharing is stopped. Reporting, blocking and leaving remain available in this session.' : 'Sharing is stopped. No new sharing is available.',
            unknown: 'No current sharing permission is recorded. Email verification does not grant it.', expired: 'Sharing permission has expired.', pending: 'Sharing permission is pending. Sharing is unavailable.',
            'policy-unavailable': 'Sharing is unavailable under the current policy.', 'policy-review-required': 'Sharing requires a policy review.', declined: 'Sharing is unavailable.', unavailable: 'Sharing permission could not be confirmed.' };
        const names = { 'public-text': 'public chat', 'public-disclosure': 'public display', 'direct-contact': 'direct contact', 'audio': 'audio', 'camera': 'camera', 'external-provider': 'external services', 'public-artifact': 'shared creative work', 'room-creation': 'creating rooms', 'room-registration': 'keeping rooms', 'media-reception': 'receiving media', 'ai-public-review': 'AI review' };
        const purposes = Array.isArray(value.purposes) ? value.purposes.map(p => names[p] || p).join(', ') : '';
        sharingStatus((labels[value.state] || labels.unavailable) + (value.available && purposes ? ` Approved: ${purposes}.` : '')
            + (app.localMediaPaused && value.state !== 'withdrawn' ? ' Local media remains off in this tab; checking permissions does not restart it.' : '')
            + (value.state === 'withdrawn' && sharingCleanup !== 'confirmed' ? ' The permission withdrawal is saved. Local media is off; server cleanup is unconfirmed. Retry stopping live sharing; close this tab if your browser still indicates capture.' : ''));
        $('[data-sharing-stop]').textContent = value.state === 'withdrawn' && sharingCleanup !== 'confirmed' ? 'Retry stopping live sharing' : 'Stop all my sharing';
        $('[data-sharing-stop]').disabled = !value.canStop || value.state === 'withdrawn' && sharingCleanup === 'confirmed';
    }
    async function sharingRequest(stop = false) {
        if (!sharingControls || sharingBusy) return;
        sharingBusy = true;
        if (stop) pauseLocalMedia();
        const confirmedBefore = sharingConfirmation;
        if (sharingRegion.contains(document.activeElement)) sharingRegion.focus({ preventScroll: true });
        for (const button of sharingRegion.querySelectorAll('button:not([data-sharing-leave])')) button.disabled = true;
        sharingStatus(stop ? 'Local media is off. Stopping new sharing… Waiting for server confirmation.' : 'Checking current sharing…');
        try {
            const response = await fetch(stop ? '/beta/participation/stop' : '/beta/participation', { credentials: 'same-origin', cache: 'no-store',
                ...(stop ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: sharingState?.revision }) } : {}) });
            if (!response.ok) throw Error('unconfirmed');
            const value = await response.json();
            if (value.ok !== true || !Number.isSafeInteger(value.revision) || typeof value.canStop !== 'boolean') throw Error('unconfirmed');
            drawSharing(value);
            if (value.state === 'withdrawn') stopLocalSharing();
        } catch {
            if (sharingConfirmation > confirmedBefore) {
                drawSharing({ ok: true, state: 'withdrawn', available: false, purposes: [], revision: sharingState?.revision || 0, canStop: true, cleanup: 'confirmed' });
            } else if (sharingState?.state === 'withdrawn') {
                if (stop) sharingCleanup = 'unconfirmed'; drawSharing({ ...sharingState, cleanup: sharingCleanup === 'confirmed' ? 'confirmed' : 'unconfirmed' });
            } else {
                sharingState = null; sharingCleanup = 'unknown'; sharingStatus(stop ? 'Local media remains off. The server withdrawal could not be confirmed. Check my sharing before trying again; close this tab if your browser still indicates capture.' : 'Sharing status is unknown. Check again; email verification does not authorize sharing.');
            }
        } finally {
            sharingBusy = false; $('[data-sharing-confirm]').hidden = true;
            $('[data-sharing-check]').disabled = false;
            $('[data-sharing-accept]').disabled = false; $('[data-sharing-cancel]').disabled = false;
            $('[data-sharing-stop]').disabled = !sharingState?.canStop || sharingState.state === 'withdrawn' && sharingCleanup === 'confirmed';
            if (document.activeElement === sharingRegion) $('[data-sharing-check]').focus({ preventScroll: true });
        }
    }
    // Local opt-out is immediate and separate from saved server permission.
    // onLeave invalidates capture/room generations as well as live tracks/PCs.
    function pauseLocalMedia() {
        app.localMediaPaused = true;
        clearGameLinks();
        clearJamInvitations();
        if (roomApi) roomApi.onLeave();
        $('[data-activity]').hidden = true; $('[data-jam]').hidden = true; $('[data-cam]').hidden = true;
        $('[data-quick]').hidden = true; $('[data-lobby-welcome]').hidden = true;
        $('[data-text]').disabled = true; $('[data-send]').disabled = true; $('[data-palette-open]').disabled = true;
        for (const button of $$('[data-start]')) button.disabled = true;
        $('[data-roomtools]').hidden = true;
        $('[data-private]').hidden = true;
        if ($('[data-cam-gate]').open) $('[data-cam-gate]').close();
        $('[data-adult]').checked = false;
        drawMessageRecovery();
    }
    function leaveSharingChat() {
        if (sessionEnded || !app.ws) return;
        pauseLocalMedia();
        const socket = app.ws; socket.onclose = null; socket.onmessage = null;
        if (socket.readyState === 0 || socket.readyState === 1) socket.close(1000, 'Left chat');
        endSession('left');
        $('[data-sharing-leave]').disabled = true;
    }
    function stopLocalSharing() {
        if (!sharingControls) return;
        app.sharingStopped = true; app.capabilities = {};
        pauseLocalMedia();
        if (pendingKeep) clearKeep('Sharing is stopped. No room action was confirmed here.');
        $('[data-activity]').hidden = true; $('[data-roombar]').hidden = true; $('[data-jam]').hidden = true;
        $('[data-pmreqs]').replaceChildren();
        $('[data-text]').disabled = true; $('[data-say] button[type="submit"]').disabled = true;
        $('[data-self-role]').textContent = 'Sharing stopped · safety controls available';
        for (const channel of app.chans.values()) { channel.names = []; channel.readOnly = true; }
        for (const channel of app.pms.values()) { channel.names = []; channel.readOnly = true; }
        app.rooms = []; drawRooms(); $('[data-nicks]').replaceChildren();
    }
    if (sharingControls) {
        $('[data-sharing-controls]').hidden = false;
        // Status and reduction remain reachable before permission to join.
        $('.gate-card').append($('[data-sharing-controls]'));
        $('[data-sharing-check]').addEventListener('click', () => sharingRequest());
        $('[data-sharing-leave]').addEventListener('click', leaveSharingChat);
        $('[data-sharing-stop]').addEventListener('click', () => { $('[data-sharing-confirm]').hidden = false; $('[data-sharing-accept]').focus(); });
        $('[data-sharing-cancel]').addEventListener('click', closeSharingConfirm);
        $('[data-sharing-accept]').addEventListener('click', () => sharingRequest(true));
        // One initial read and explicit refresh only; never poll private status.
        Promise.resolve().then(() => sharingRequest());
    }
    const entrySharing = createEntrySharing({ source: entrySource, enabled: shareEntry, registry: entrySites, send: (frame) => send(frame), onChange: () => drawEntryChoice() });
    function prepareOwnerSignin(current = null) {
        const intent = current ? keepRoomIntent(current, Date.now()) : null;
        if (current && (!keepSupported || !intent)) {
            toast('This chat version cannot return safely to this room. Use the email sign-in link, then choose the current room.');
            return false;
        }
        try {
            sessionStorage.removeItem(KEEP_ROOM_INTENT_KEY);
            sessionStorage.setItem(ENTRY_HANDOFF_KEY, entryHandoff(entrySource, shareEntry, Date.now(), entrySites));
            if (intent) sessionStorage.setItem(KEEP_ROOM_INTENT_KEY, intent);
        } catch { toast('This tab cannot save your sign-in return. You can keep chatting; allow tab storage before trying again.'); return false; }
        clearMessageRecovery();
        return true;
    }
    function clearKeep(message = '') {
        const prompt = $('[data-keep-prompt]'), heldFocus = prompt.contains(document.activeElement);
        clearTimeout(keepTimer); pendingKeep = null;
        prompt.hidden = true;
        if (heldFocus) {
            const current = app.chans.get(app.active);
            const visible = element => element && !element.disabled && !element.closest('[hidden]') && getComputedStyle(element).display !== 'none';
            const host = current && current.kind !== 'lobby' && amOp(current) ? $('[data-roomtools]') : null;
            const target = [host, $('[data-text]')].find(visible);
            target?.focus({ preventScroll: true });
        }
        if (message) toast(message);
    }
    function drawKeepPrompt() {
        if (!pendingKeep || pendingKeep.stage === 'joining') return;
        const current = app.chans.get(pendingKeep.room);
        if (Date.now() - pendingKeep.at >= KEEP_ROOM_INTENT_TTL || Date.now() < pendingKeep.at)
            return clearKeep(pendingKeep.stage === 'submitted' ? 'Keeping this room was not confirmed. Check Host tools before trying again.' : 'Your room return expired. Choose the current room before keeping it.');
        if (connectionState !== 'connected' || !app.verified || !current || current.keepRef !== pendingKeep.ref)
            return clearKeep(pendingKeep.stage === 'submitted' ? 'The room or sign-in changed before confirmation. Check Host tools after signing in again.' : 'That room or sign-in changed. Nothing was kept.');
        if (current.persistent) return clearKeep('This room is registered. Check Host tools for your current access.');
        if (!amOp(current)) return clearKeep(pendingKeep.stage === 'submitted' ? 'Your host controls changed before confirmation. Check Host tools for the current status.' : 'Your host controls changed. Nothing was kept.');
        $('[data-keep-prompt]').hidden = app.active !== pendingKeep.room;
        $('[data-keep-message]').textContent = pendingKeep.stage === 'submitted'
            ? `Asking the server to keep ${pendingKeep.room}…`
            : `Email verified. Keep ${pendingKeep.room} across visits?`;
        // Keep focus in the labelled region before disabling its focused button.
        // An acknowledgement must not later steal focus if the visitor moved away.
        if (pendingKeep.stage === 'submitted' && $('[data-keep-prompt]').contains(document.activeElement))
            $('[data-keep-prompt]').focus({ preventScroll: true });
        $('[data-keep-accept]').disabled = pendingKeep.stage === 'submitted';
        $('[data-keep-cancel]').disabled = pendingKeep.stage === 'submitted';
    }
    function returnToKeepRoom() {
        if (keepReturnChecked) return;
        keepReturnChecked = true;
        let result;
        try { result = consumeKeepRoomIntent(sessionStorage, Date.now()); }
        catch { result = { unavailable: true }; }
        if (result.unavailable) return toast('This tab could not read your room return. Chat is available; choose the current room manually.');
        if (!result.intent) { if (result.hadIntent) toast('Your room return expired or was not recognized. Nothing was kept.'); return; }
        if (!app.verified || !keepSupported || params.get('owner') !== '1' || params.get('entry-return') !== '1')
            return toast('The room return was not confirmed by this sign-in. Choose the current room manually.');
        pendingKeep = { ...result.intent, stage: 'joining' };
        keepTimer = setTimeout(() => clearKeep(pendingKeep?.stage === 'submitted' ? 'Keeping this room was not confirmed. Check Host tools before trying again.' : 'Your room return expired. Nothing was kept.'), KEEP_ROOM_INTENT_TTL - (Date.now() - pendingKeep.at));
        if (!cmd('join', [pendingKeep.room], '#stalemate', pendingKeep.ref)) clearKeep('The room return could not be sent. Nothing was kept.');
    }

    function drawEntryChoice() {
        $$('[data-entry-context]').forEach((element) => { element.hidden = !entrySource || entrySourcesSupported === false; });
        $$('[data-entry-unavailable]').forEach((element) => { element.hidden = !entrySource || entrySourcesSupported !== false; });
        $$('[data-entry-label]').forEach((element) => { element.textContent = entryBadge(entrySource, entrySites); });
        $$('[data-entry-share]').forEach((element) => { element.checked = shareEntry; element.disabled = entrySourcesSupported === false; });
        const sharing = entrySharing.snapshot();
        $$('[data-entry-context]').forEach((element) => {
            let status = $('[data-entry-status]', element);
            if (!status) {
                status = document.createElement('p'); status.className = 'small';
                status.dataset.entryStatus = ''; status.setAttribute('role', 'status'); element.append(status);
            }
            status.hidden = sharing.state === 'offline' || sharing.state === 'unavailable';
            status.textContent = sharing.state === 'rejected'
                ? (shareEntry ? 'Entrance sharing was not updated. Choose again or reconnect.' : 'Your entrance is still shared. Try hiding again or reconnect before sending.')
                : sharing.state === 'pending'
                    ? (shareEntry ? 'Updating entrance sharing…' : 'Hiding your entrance… Messages wait for confirmation.')
                    : (shareEntry ? 'Entrance shared with People and new messages.' : 'Entrance hidden from People and new messages.');
        });
        const back = entryReturn(entrySource, entrySites);
        $$('[data-entry-return]').forEach((element) => {
            element.hidden = !back;
            if (back) { element.href = back.href; element.textContent = back.label; }
        });
    }
    $$('[data-entry-share]').forEach((element) => element.addEventListener('change', () => {
        shareEntry = element.checked;
        drawEntryChoice();
        entrySharing.setEnabled(shareEntry);
    }));
    drawEntryChoice();
    // Drafts are tab-local only. Chat, PMs and invitation links are never copied into browser storage.
    const drafts = new Map();
    const pendingReports = new Map();
    let connectionState = 'offline';
    let sessionEnded = false;
    let endedPmLabel = null; // Display only; never a view, endpoint or send context.
    let inviteContext = null;
    let replaying = false;
    const announcements = createChatAnnouncements($('[data-buffer]'));
    $('[data-chat-announcements]').addEventListener('change', (event) => announcements.setEnabled(event.currentTarget.checked));
    let belowFold = 0;
    let roomApi = null;
    let jamContext = null;
    let pendingJamShare = null;
    let jamShareResultsSupported = false, jamShareTimer;
    let gameNightSupported = false, gameOpenSupported = false, gameGuestInvitesSupported = false, discordLinksSupported = false, shieldActive = false, gameEditorRoom = null;
    const gameShareButton = $('[data-game-share]'), gameShareDialog = $('[data-game-share-dialog]'), gameShareValue = $('[data-game-share-value]');
    const arcadeTables = new Map([
        ['chess', { label: 'Royal Flush Chess', load: () => import('./arcade-chess.mjs').then(module => module.mountArcadeChess) }],
        ['crapeights', { label: 'Crappy Eights', load: () => import('./arcade-crapeights.mjs').then(module => module.mountArcadeCrapeights) }],
        ['turdrummy', { label: 'TurdRummy', load: () => import('./arcade-turdrummy.mjs').then(module => module.mountArcadeTurdRummy) }],
        ['turdspades', { label: 'TurdSpades', load: () => import('./arcade-turdspades.mjs').then(module => module.mountArcadeTurdSpades) }],
        ['turdjack', { label: 'Crapjack 21', load: () => import('./arcade-turdjack.mjs').then(module => module.mountArcadeTurdJack) }],
        ['turdtris', { label: 'Turdtris Sprint', load: () => import('./arcade-turdtris.mjs').then(module => module.mountArcadeTurdtris) }],
        ['turdomania', { label: 'Turdomania Duel', load: () => import('./arcade-turdomania.mjs').then(module => module.mountArcadeTurdomania) }],
        ['turdrush', { label: 'Turd Rush Race', load: () => import('./arcade-turdrush.mjs').then(module => module.mountArcadeTurdRush) }],
        ['turdanoid', { label: 'Turdanoid Brick Race', load: () => import('./arcade-turdanoid.mjs').then(module => module.mountArcadeTurdanoid) }]
    ]);
    const gameLabel = game => arcadeTables.get(game)?.label || gameNightLabels[game] || 'Game Night';
    let arcadeReturning = null, arcadeInvitation = null, arcadeShareIntent = null;
    let arcadeMediaSupported = false, arcadeMedia = null, arcadeMediaLoading = false;
    let fourInARowSupported = false, fourRoom = null, fourPlayed = false;
    let fourGameId = '', fourActionPending = false, fourInvite = null;
    const fourButtons = [], fourCells = [];
    const gameReturnKey = 'hangout-game-return';
    const gameInvites = new Map();
    let gameReturn = null, gameReturnOffered = false, joiningGameRoom = '', joiningArcadeOffer = null;
    let gameOpenPending = null, gameOpenError = '';
    // Jam rooms are invite-only like Game Night, so the directory cannot lead
    // an invited guest back. They share the same offer and return controls.
    const jamRoomName = name => typeof name === 'string' && /^#jam(?:-[a-z0-9-]{1,26})?$/.test(name);
    const offerRoomName = name => jamRoomName(name) || gameNightSupported && gameNightRoomName(name);
    function stopLocalCamera(channel) {
        const c = app.chans.get(channel);
        if (!c) return false;
        c.myCam = false;
        roomApi?.onCam(channel, false);
        if (app.active === channel) drawChan();
        return send({ t: 'cam', ch: channel, on: false });
    }
    function room() {
        if (app.sharingStopped || app.localMediaPaused) return null;
        if (!roomApi && window.LobbyRoom) {
            roomApi = window.LobbyRoom.attach({ app, send, $, previewKey, turnUrl, isLocal, params, onCameraFailure: stopLocalCamera });
        }
        return roomApi;
    }
    const activityRoom = c => c && ['art', 'bobross', 'watch'].includes(c.kind)
        && connectionState === 'connected' && !sessionEnded && !app.localMediaPaused && !app.sharingStopped && !c.readOnly;
    function activitySnapshot(snapshot) {
        const state = window.HangoutCore.emptyState();
        // The shared decoder copies nested strokes/video. The renderer's
        // optimistic local state must never become a joined room's cache.
        window.HangoutCore.apply(state, { type: 'snapshot', state: snapshot });
        return { strokes: state.strokes.slice(-400), video: state.video };
    }
    function cacheActivity(c, m) {
        if (!c.actSnap) c.actSnap = activitySnapshot();
        if (m.kind === 'stroke') window.HangoutCore.apply(c.actSnap, { type: 'stroke', stroke: m.stroke });
        if (m.kind === 'clear') window.HangoutCore.apply(c.actSnap, { type: 'clear' });
        if (m.kind === 'video' && m.video) window.HangoutCore.apply(c.actSnap,
            { type: 'video', source: m.video.source, playing: m.video.playing, pos: m.video.pos }, { t: m.video.t });
        if (c.actSnap.strokes.length > 400) c.actSnap.strokes.splice(0, c.actSnap.strokes.length - 400);
    }
    const nickInput = $('[data-nick]');
    nickInput.value = nickInput.value || readRemembered('hangout-nick') || ''; // blank by default; remembered on this device
    $('[data-reroll]').addEventListener('click', (e) => {
        const r = window.StaleNames.roll();
        nickInput.value = r.name;
        e.currentTarget.textContent = '🎲 Roll again';
        gateStatus(r.legendary ? '✨ LEGENDARY name! Keep it, it’s rare.' : '');
        nickInput.focus();
    });

    const gateStatus = (t) => { $(gameGuest ? '[data-game-guest-status]' : '[data-gate-status]').textContent = t; };
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
        if (state !== 'connected') {
            if (gameOpenPending) {
                clearTimeout(gameOpenPending.timer); gameOpenPending = null;
                gameOpenError = 'Connection interrupted. Reconnect and try opening Game Night again.';
            }
            gameInvites.clear(); gameReturnOffered = false; joiningGameRoom = ''; drawGameOffer();
            joiningArcadeOffer = null;
            finishArcadeInvitation();
            clearGameLinks(); clearJamInvitations();
            if (pendingKeep) clearKeep(pendingKeep.stage === 'submitted' ? 'Keeping this room was not confirmed. Check Host tools after reconnecting.' : 'Your room return was interrupted. Nothing was kept.');
        }
        const label = { offline: 'Offline', connecting: 'Connecting…', reconnecting: 'Reconnecting…', connected: 'Connected', ended: 'Session ended' }[state];
        $('[data-connection]').textContent = label;
        $('[data-connection]').dataset.state = state;
        $('[data-send]').disabled = state !== 'connected';
        $('[data-enter]').disabled = state === 'connecting' || state === 'reconnecting' || state === 'ended' && betaShell;
        if (gameGuest) $('[data-game-guest-retry]').hidden = state !== 'offline' && !gameGuestReloadOffered;
        $('[data-reconnect]').hidden = !(state === 'offline' || state === 'ended' && !betaShell) || !app.me;
        $$('[data-start]').forEach((b) => { b.disabled = state !== 'connected'; });
        if (state === 'offline' && app.pendingChannel) {
            app.pendingChannel = '';
            $('[data-channel-error]').textContent = 'Connection lost. Reconnect and try this channel again.';
        }
        drawCommunity(); drawRooms(); drawMessageRecovery(); refreshPaletteCohosts();
    }
    const JOIN_TIMEOUT_MS = 20_000;
    const GAME_GUEST_RETRY_DELAY_MS = 5_000;
    let cancelTransportAck = () => {};
    let cancelEntryCheck = () => {}, pageLeaving = false;
    window.addEventListener('pagehide', () => { pageLeaving = true; cancelEntryCheck(); });
    window.addEventListener('pageshow', () => { pageLeaving = false; });
    function privateAccessMissing() {
        cancelEntryCheck();
        return new Promise((resolve) => {
            const controller = new AbortController();
            let settled = false;
            const finish = (missing) => {
                if (settled) return;
                settled = true; clearTimeout(timer); controller.abort();
                if (cancelEntryCheck === cancel) cancelEntryCheck = () => {};
                resolve(missing);
            };
            const cancel = () => finish(false);
            const timer = setTimeout(cancel, 3000);
            cancelEntryCheck = cancel;
            // WebSocket handshake failures hide their HTTP status. Probe only
            // the protected shell's own read-only endpoint, without retrying,
            // following redirects, refreshing access or exposing credentials.
            try {
                fetch('/beta/state' + gameGuestQuery, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal })
                    .then((response) => finish(response.status === 401), cancel);
            } catch { cancel(); }
        });
    }
    async function connect(nick) {
        if (sessionEnded && betaShell) return;
        if (savedMessages.size && !confirm('A saved message may already have arrived. Reconnecting clears every saved copy in this tab. Copy any text you need first. Reconnect and clear the copies?')) return;
        clearMessageRecovery(); messageResultsSupported = false;
        sessionEnded = false; $('[data-session-ended]').hidden = true; $('[data-text]').readOnly = false;
        const attempt = ++connectionAttempt;
        cancelEntryCheck();
        const privateEntry = $('[data-gate-private-entry]');
        if (privateEntry) privateEntry.hidden = true;
        cancelTransportAck();
        entrySharing.disconnect();
        privateMessageContextSupported = false; keepSupported = false;
        entrySourcesSupported = null; drawEntryChoice();
        clearTimeout(retryTimer);
        setConnection(app.me ? 'reconnecting' : 'connecting');
        if (gameGuest && !gameGuestSeated) {
            gameGuestReloadOffered = false;
            gateStatus('Joining the game…');
            $('[data-game-guest-retry]').hidden = true;
        }
        const tsToken = ownerSession ? '' : await loadTurnstile();
        if (attempt !== connectionAttempt) return;
        if (!ownerSession && siteKey && !tsToken) { setConnection('offline'); return gateStatus('The guest check couldn’t finish. Please try again.'); }
        const q = new URLSearchParams({ preview: previewKey, 'device-in-hello': '1' });
        if (gameGuest) { q.set('game-guest', '1'); q.set('game-room', gameGuest.ref); }
        const dev = readRemembered('hangout-dev');
        if (dev) q.set('dev', dev);
        if (tsToken) q.set('ts', tsToken);
        if (app.ws) { app.ws.onclose = null; app.ws.onmessage = null; app.ws.close(1000); }
        const ws = new WebSocket(`${relayBase}/${ownerSession ? 'lobby-owner' : 'lobby'}?${q}`);
        app.ws = ws;
        const heartbeat = createIdleHeartbeat(ws, () => attempt === connectionAttempt && app.ws === ws);
        let opened = false;
        let sessionNick = nick;
        let joinTimer, guestRetryTimer, ackTimer, ackSeq = 0, ackFrames = 0, ackSentAt = -Infinity;
        cancelTransportAck = () => {
            clearTimeout(joinTimer);
            clearTimeout(guestRetryTimer);
            clearTimeout(ackTimer); ackTimer = null; ackFrames = 0; heartbeat.stop();
        };
        const flushAck = () => {
            clearTimeout(ackTimer); ackTimer = null;
            if (attempt === connectionAttempt && ws.readyState === 1 && ackFrames) {
                // Coalesce a busy room's handled frames without exceeding the
                // server's 20-controls/second allowance during join bursts.
                const remaining = 50 - (performance.now() - ackSentAt);
                if (remaining > 0) { ackTimer = setTimeout(flushAck, remaining); return; }
                ws.send(JSON.stringify({ t: 'transport-ack', seq: ackSeq }));
                ackSentAt = performance.now();
            }
            ackFrames = 0;
        };
        ws.onopen = () => { opened = true; };
        ws.onmessage = (e) => {
            if (attempt !== connectionAttempt) return;
            let m; try { m = JSON.parse(e.data); } catch (err) { return; }
            if (!m || typeof m !== 'object') return;
            heartbeat.received();
            if (m.t === 'hello') heartbeat.negotiate(m.features?.transportPing);
            if (m.t === 'welcome' || m.t === 'nick-error') {
                clearTimeout(joinTimer);
                clearTimeout(guestRetryTimer);
            }
            if (m.t === 'welcome') sessionNick = m.nick;
            if (m.t !== 'transport-pong') handle(m, sessionNick);
            if (Number.isSafeInteger(m.transportSeq) && m.transportSeq > 0) {
                ackSeq = Math.max(ackSeq, m.transportSeq); ackFrames += 1;
                if (ackFrames >= 8) flushAck();
                else if (!ackTimer) ackTimer = setTimeout(flushAck, 50);
            }
        };
        const onClose = async (e, timedOut = false) => {
            if (attempt !== connectionAttempt) return;
            cancelTransportAck();
            entrySharing.disconnect();
            privateMessageContextSupported = false; privateMessagePeersSupported = false; personTargetsSupported = false; app.selfId = '';
            personPreferencePending = null;
            resetPendingReports();
            uncertainMessages();
            setConnection('offline');
            if (roomApi) roomApi.onLeave();
            if (timedOut) {
                const message = 'Hang Out took too long to respond. Try again.';
                gateStatus(message);
                if (app.me) line(app.active, { event: true, text: `* ${message}` });
                return;
            }
            if (e.code === 4401) return endSession();
            if (!opened && betaShell && !pageLeaving) {
                const missing = await privateAccessMissing();
                if (attempt !== connectionAttempt || app.ws !== ws || sessionEnded || pageLeaving) return;
                if (missing) {
                    if (app.me) return endSession('private-access');
                    gateStatus(gameGuest ? 'Your game access expired. Ask your host for a fresh invitation.' : 'Your private access needs renewal. Reopen your invitation link or enter its code.');
                    if (privateEntry) privateEntry.hidden = false;
                    return;
                }
            }
            if (!opened && app.me) return endSession('admission');
            if (ownerSession && !opened) {
                $('[data-gate]').hidden = false; $('[data-app]').hidden = true;
                $('[data-gate-guest]').hidden = false;
                return gateStatus('Email sign-in is unavailable or expired. Sign in again to manage your rooms, or continue as a guest.');
            }
            if (!opened) return gateStatus('Couldn’t connect. Try again shortly, or ask the host if this continues.');
            if (savedMessages.size) {
                clearTimeout(retryTimer);
                gateStatus('A message may have arrived. Copy or discard saved text, then choose Try again. Reconnecting clears saved copies.');
                return;
            }
            if ([1009, 4400, 4413, 4429].includes(e.code)) {
                clearTimeout(retryTimer);
                const message = 'Connection paused to protect community capacity. Choose Try again when ready; reload if this keeps happening.';
                gateStatus(message);
                line(app.active, { event: true, text: `* ${message}` });
                return;
            }
            if ([4001, 4003, 4503, 4403].includes(e.code) || app.kicked || e.code === 1000) return;
            line(app.active, { event: true, text: '* Disconnected. Reconnecting…' });
            setConnection('reconnecting');
            retryTimer = setTimeout(() => connect(app.me || nick), Math.min(10000, 1000 * (2 ** Math.min(retry++, 4))) * (0.75 + Math.random() * 0.25));
        };
        ws.onclose = onClose;
        if (gameGuest && !gameGuestSeated) guestRetryTimer = setTimeout(() => {
            if (attempt !== connectionAttempt || app.ws !== ws) return;
            gateStatus('Still connecting to your game…');
            $('[data-game-guest-retry]').hidden = false;
        }, GAME_GUEST_RETRY_DELAY_MS);
        joinTimer = setTimeout(() => {
            if (attempt !== connectionAttempt || app.ws !== ws) return;
            // An open socket alone does not confirm that the visitor joined.
            ws.onopen = ws.onmessage = ws.onclose = null;
            ws.close(1000);
            void onClose({ code: 1000 }, true);
        }, JOIN_TIMEOUT_MS);
    }
    function endSession(reason = 'expired') {
        const wasVerified = ownerSession || app.verified;
        const privateView = app.active.startsWith('pm:') ? store(app.active) : null;
        endedPmLabel = privateView?.nick ? { key: app.active, nick: privateView.nick }
            : endedPmLabel?.key === app.active ? endedPmLabel : null;
        clearMessageRecovery(); messageResultsSupported = false;
        sessionEnded = true; connectionAttempt++;
        cancelEntryCheck();
        clearTimeout(retryTimer); cancelTransportAck();
        // Keep the unsent text under its original channel/PM key. Never move a
        // private draft into #stalemate or persist it during re-authentication.
        drafts.set(app.active, $('[data-text]').value);
        clearGameReturn();
        app.chans.clear(); app.pms.clear(); app.rooms = []; app.pendingChannel = '';
        app.band = false; app.verified = false; app.role = 'fan'; app.capabilities = {};
        ownerSession = false; removeTab('hangout-owner');
        $('[data-owner-signout]').hidden = true; $('[data-gate-guest]').hidden = true;
        $('[data-self-role]').textContent = 'Session ended';
        $('[data-room-filter] option[value=mine]').disabled = true;
        if ($('[data-room-filter]').value === 'mine') $('[data-room-filter]').value = 'active';
        app.ignores.clear(); app.peerIgnores.clear(); app.selfId = ''; personPreferencePending = null; $('[data-pmreqs]').replaceChildren();
        clearTimeout(toastTimer); toastRegion.replaceChildren(); toastRegion.hidden = true;
        for (const dialog of $$('dialog')) if (dialog.open) dialog.close();
        inviteContext = null; $('[data-invite-nick]').value = ''; $('[data-invite-options]').replaceChildren();
        $('[data-sheet-buttons]').replaceChildren(); $('[data-palette-buttons]').replaceChildren();
        $('[data-adult]').checked = false;
        document.body.classList.remove('is-band', 'am-op');
        announcements.replace(() => $('[data-chat-lines]').replaceChildren());
        setConnection('ended'); drawTabs(); drawChan();
        $('[data-text]').readOnly = true;
        const ended = reason === 'private-access' ? 'Your private community access needs renewal.'
            : reason === 'left' ? 'You left this chat. Your sign-in and any recorded sharing withdrawal have not been changed.' : reason === 'admission'
            ? 'Couldn’t reconnect. The service may be unavailable or your sign-in may have expired.'
            : wasVerified ? 'Your verified sign-in expired or was revoked.' : 'Your guest session expired or was revoked.';
        const next = reason === 'left' ? 'Return to the community to start a new chat session.' : betaShell
            ? wasVerified ? 'Return to your invitation, then verify your email again to recover your rooms.' : 'Return to your private invitation to join again.'
            : wasVerified ? 'Choose Try again to continue as a guest. Sign in again to recover your registered rooms.' : 'Choose Try again to start a fresh session.';
        $('[data-session-reason]').textContent = gameGuest ? `${gameGuestExitMessage(reason)} Ask your host for a fresh invitation.` : `${ended} ${next} Cameras are off.`;
        $('[data-session-reentry]').hidden = !betaShell || !!gameGuest;
        $('[data-session-reentry]').textContent = reason === 'left' ? 'Return to community' : 'Return to invitation';
        if (gameGuest) $('[data-game-guest-connecting]').hidden = true;
        $('[data-session-ended]').hidden = false;
        show('chat'); $('#session-ended-title').focus({ preventScroll: true });
    }
    function gameGuestExitMessage(reason) {
        return { left: 'You left Game Night.', canceled: 'You canceled joining Game Night.', closed: 'This Game Night room closed.', removed: 'You were removed from Game Night.' }[reason] || 'Your Game Night access ended.';
    }
    function leaveGameGuest(reason) {
        if (reason === 'canceled' && app.ws) {
            app.ws.onclose = null;
            app.ws.onmessage = null;
            if (app.ws.readyState < WebSocket.CLOSING) app.ws.close(1000);
        }
        gameGuestExit = reason;
        history.replaceState({ gameSessionRef: gameGuest.sessionRef, gameExit: reason }, '', location.pathname + gameGuestQuery);
        endSession(reason);
        void closeGameGuestAccess();
    }
    async function closeGameGuestAccess() {
        const status = $('[data-session-reason]'), retry = $('[data-game-guest-exit-retry]');
        const message = gameGuestExitMessage(gameGuestExit);
        retry.hidden = true;
        status.textContent = `${message} Closing the invitation…`;
        try {
            const response = await fetch('/beta/game-night/invitation/leave', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionRef: gameGuest.sessionRef }), keepalive: true,
                signal: AbortSignal.timeout(10000)
            });
            if (!response.ok || (await response.json()).ok !== true) throw new Error('Invitation close unconfirmed');
            status.textContent = `${message} Ask your host for a fresh invitation.`;
        } catch {
            status.textContent = `${message} The invitation could not be closed. Try again.`;
            retry.hidden = false;
        }
    }
    const send = (obj) => {
        const commandName = obj.t === 'cmd' ? String(obj.name || '').toLowerCase()
            : obj.t === 'say' && /^\/(?!\/)/.test(obj.text || '') ? obj.text.slice(1).split(/\s/, 1)[0].toLowerCase() : '';
        const safeCommand = ['block', 'unblock', 'ignore', 'unignore', 'part', 'leave', 'quit', 'exit', 'bye', 'help', 'h', '?', 'camoff', 'decline', 'deny'].includes(commandName);
        if (app.sharingStopped || app.localMediaPaused) {
            if (obj.t !== 'report' && !safeCommand) return false;
        }
        if (!app.ws || app.ws.readyState !== 1) return false;
        if (obj.t !== 'hello' && connectionState !== 'connected') return false;
        if (typeof obj.ch === 'string' && obj.ch.startsWith('pm:')) {
            const text = typeof obj.text === 'string' ? obj.text : '';
            const name = obj.t === 'cmd' ? String(obj.name || '').toLowerCase()
                : /^\/(?!\/)/.test(text) ? text.slice(1).split(/\s/, 1)[0].toLowerCase() : '';
            const implicit = obj.t === 'say' && (!name || ['me', 'slap'].includes(name))
                || obj.t === 'cmd' && ['me', 'slap', 'msg', 'm'].includes(name) && obj.pmExplicit !== true;
            if (implicit) {
                const view = store(obj.ch);
                if (!privateMessagePeersSupported || !view?.open || !view.peer || !view.ref) {
                    pmDraftNotice(view); return false;
                }
                if (!privateMessageContextSupported && ['me', 'slap'].includes(name)) {
                    toast('This command is unavailable in private chat on this server. Your draft stays here.'); return false;
                }
                obj = { ...obj, pmPeer: view.peer, pmRef: view.ref };
            } else if (!privateMessageContextSupported && !legacyPrivateCommands.has(name)) {
                toast('This command is unavailable in private chat on this server. Your draft stays here.'); return false;
            }
        }
        const writesMessage = obj.t === 'say' && !safeCommand || obj.t === 'cmd' && ['me', 'slap', 'msg', 'm'].includes(String(obj.name || '').toLowerCase());
        if (writesMessage && !entrySharing.canSend()) {
            toast('Wait for confirmation that your entrance is hidden, or reconnect. Your draft stays here.');
            return false;
        }
        const payload = JSON.stringify(obj);
        if (Number.isFinite(app.ws.bufferedAmount) && app.ws.bufferedAmount + new Blob([payload]).size > 2 * 1024 * 1024) {
            app.ws.close(4413, 'outgoing connection fell behind');
            return false;
        }
        try {
            app.ws.send(payload);
            const name = obj.t === 'cmd' ? String(obj.name || '').toLowerCase()
                : obj.t === 'say' && /^\/(?!\/)/.test(obj.text || '') ? String(obj.text).slice(1).split(/\s/, 1)[0].toLowerCase() : '';
            if (['quit', 'exit', 'bye'].includes(name)) clearMessageRecovery();
            return true;
        } catch { return false; }
    };
    const cmd = (name, args = [], ch = app.active, roomInstance) => send({ t: 'cmd', name, args, ch, ...(['msg', 'm'].includes(name) ? { pmExplicit: true } : {}), ...(roomInstance === undefined ? {} : { roomInstance }) });
    // Named intent is explicit at prompt/API call sites, never added by the
    // generic command wrapper used by selected-person controls.
    const namedPersonCommands = new Set(['query', 'q', 'whois', 'w', 'ignore', 'unignore', 'block', 'unblock', 'accept', 'decline', 'deny', 'slap', 'invite', 'kick', 'ban', 'gban', 'mute', 'purge', 'op', 'deop', 'voice', 'devoice', 'cohost', 'transfer', 'report']);
    const namedCmd = (name, args = [], ch = app.active, roomInstance) => {
        const command = String(name).toLowerCase();
        if (ch.startsWith('pm:') && command === 'slap') return send({ t: 'say', ch, text: `/slap ${args.join(' ')}` });
        const rankMode = command === 'mode' && /[ov]/.test(String(/^#/.test(args[0] || '') ? args[1] || '' : args[0] || ''));
        return namedPersonCommands.has(command) || rankMode
            ? send({ t: 'cmd', name, args, ch, personNamed: true, ...(roomInstance === undefined ? {} : { roomInstance }) })
            : cmd(name, args, ch, roomInstance);
    };
    app.cmd = namedCmd;
    const personId = value => typeof value === 'string' && value.length > 0 && value.length <= 160 && !/\s|[\u0000-\u001f\u007f]/.test(value);
    const roomNonce = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
    let personPreferencePending = null, personSheetSelection = null;
    const findPerson = id => { for (const channel of app.chans.values()) { const person = channel.names?.find(row => row.id === id); if (person) return person; } return null; };
    const personLabel = context => findPerson(context.peer)?.nick || context.label || 'this visitor';
    function personContext(peer, channel, instance, label) { return { peer, channel, instance, label }; }
    function personContextValid(context) {
        return personTargetsSupported && personId(context?.peer) && !!app.selfId && context.peer !== app.selfId
            && typeof context.channel === 'string' && context.channel.startsWith('#') && roomNonce(context.instance);
    }
    function personCommand(context, name, args = []) {
        const current = context && app.chans.get(context.channel);
        const safety = ['block', 'ignore', 'unignore'].includes(name);
        if (!personContextValid(context) || connectionState !== 'connected' || !current || current.keepRef !== context.instance
            || !safety && !findPerson(context.peer)) {
            personSheetStatus('That person or room is no longer confirmed. Choose a current person.'); return false;
        }
        const values = [...args]; if (values.length) values[0] = personLabel(context);
        const sent = send({ t: 'cmd', name, args: values, ch: context.channel, roomInstance: context.instance, personContext: 1, personPeer: context.peer });
        if (!sent) personSheetStatus('The action was not sent. Reconnect before trying again.');
        return sent;
    }
    function personSheetStatus(text) {
        const sheet = $('[data-sheet]');
        let status = sheet.querySelector('[data-person-status]');
        if (sheet.open) {
            if (!status) { status = document.createElement('p'); status.dataset.personStatus = ''; status.className = 'status'; status.setAttribute('role', 'status'); sheet.append(status); }
            status.textContent = text;
        } else toast(text);
    }
    function acknowledgePersonPreferences(frame) {
        const names = frame.names, peers = frame.peers;
        if (!personTargetsSupported || !Array.isArray(names) || !Array.isArray(peers) || names.length + peers.length > 50
            || new Set(names).size !== names.length || new Set(peers).size !== peers.length
            || !names.every(name => typeof name === 'string' && /^[a-z][a-z0-9_\-\[\]{}^`|]{2,19}$/.test(name)) || !peers.every(personId)) return;
        app.ignores = new Set(names); app.peerIgnores = new Set(peers);
        if (personPreferencePending) {
            const pending = personPreferencePending;
            const matched = pending.named ? pending.name === 'unignore' && !app.ignores.has(pending.named)
                : pending.name === 'ignore' ? app.peerIgnores.has(pending.peer) : pending.name === 'unignore' && !app.peerIgnores.has(pending.peer);
            if (matched) { personPreferencePending = null; personSheetStatus('Your preference is confirmed.'); }
        }
        const ignore = $('[data-sheet] [data-person-ignore]');
        if (ignore && personSheetSelection) ignore.textContent = app.peerIgnores.has(personSheetSelection.peer) ? 'Unignore' : 'Ignore';
    }

    function handle(m, nick) {
        switch (m.t) {
        case 'rate-limit':
            if (personPreferencePending) { personPreferencePending = null; personSheetStatus('That preference was not confirmed. Try again when the connection is ready.'); }
            if (pendingKeep) clearKeep('The Keep request was not confirmed. Choose the current room and try again later.');
            resetPendingReports();
            if (connectionState !== 'connected') { setConnection('offline'); gateStatus(m.text); app.ws?.close(1000); }
            else toast(m.text);
            break;
        case 'report-status': if (m.submitted === true) finishReport(m.id, true); break;
        case 'message-result': messageResult(m); break;
        case 'jam-share-result': jamShareResult(m); break;
        case 'ownership': { const c = store(m.ch); if (c) c.cohosts = m.cohosts; refreshPaletteCohosts(); break; }
        case 'owner-offer': toast(`${m.by} offered you ownership of ${m.ch}`, [['Accept ownership', () => { if (confirm(`Accept ownership of ${m.ch}?`)) cmd('acceptowner', [], m.ch); }]]); break;
        case 'sharing-stopped':
            sharingConfirmation++; sharingCleanup = 'confirmed';
            stopLocalSharing();
            if (sharingControls) { drawSharing({ ok: true, state: 'withdrawn', available: false, purposes: [], revision: sharingState?.revision || 0, canStop: true, cleanup: 'confirmed' }); }
            break;
        case 'device': writeRemembered('hangout-dev', m.token); break;
        case 'hello':
            if (typeof m.deviceToken === 'string' && m.deviceToken) writeRemembered('hangout-dev', m.deviceToken);
            endedPmLabel = null;
            messageResultsSupported = m.features?.messageResults === 1;
            jamShareResultsSupported = m.features?.jamShareResults === 1;
            gameNightSupported = m.features?.gameNight === 1;
            gameOpenSupported = m.features?.gameOpen === 1;
            gameGuestInvitesSupported = m.features?.gameGuestInvites === 1;
            arcadeTables.get('chess').supported = m.features?.arcadeChess === 1;
            arcadeTables.get('crapeights').supported = m.features?.arcadeCrapeights === 1;
            arcadeTables.get('turdrummy').supported = m.features?.arcadeTurdRummy === 1;
            arcadeTables.get('turdspades').supported = m.features?.arcadeTurdSpades === 1;
            arcadeTables.get('turdjack').supported = m.features?.arcadeTurdJack === 1;
            arcadeTables.get('turdtris').supported = m.features?.arcadeTurdtris === 1;
            arcadeTables.get('turdomania').supported = m.features?.arcadeTurdomania === 1;
            arcadeTables.get('turdrush').supported = m.features?.arcadeTurdRush === 1;
            arcadeTables.get('turdanoid').supported = m.features?.arcadeTurdanoid === 1;
            arcadeMediaSupported = m.features?.arcadeMedia === 1;
            fourInARowSupported = m.features?.fourInARow === 1;
            discordLinksSupported = m.features?.discordLinks === true;
            shieldActive = m.shield === true;
            $('[data-start="game"]').hidden = !gameNightSupported;
            entrySourcesSupported = m.features?.entrySources === 1;
            privateMessageContextSupported = m.features?.privateMessageContext === 1;
            privateMessagePeersSupported = m.features?.privateMessagePeers === 1;
            personTargetsSupported = m.features?.personTargets === 1; app.selfId = ''; personPreferencePending = null;
            app.ignores.clear(); app.peerIgnores.clear();
            entrySharing.setSupported(entrySourcesSupported); drawEntryChoice();
            keepSupported = m.features?.roomKeep === 1;
            app.role = m.role; app.verified = m.verified === true; app.capabilities = m.capabilities || {}; $('[data-owner-signout]').hidden = !ownerSession; app.netLock = m.lock; app.budget = m.budget;
            if (app.me) {
                app.resetSession = true; setConnection('reconnecting');
                drafts.set(app.active, $('[data-text]').value);
                if (roomApi) roomApi.onLeave();
                // A rehearsal outlasts the return window. Restart it at the
                // reconnect, not at the last time the room tab was opened.
                const returning = app.chans.get(gameReturn?.room);
                if (returning) rememberGameReturn(returning);
                app.chans.clear();
                for (const [ref, view] of app.pms) {
                    // A new socket starts a fresh received transcript. Only
                    // an unsent draft keeps a closed, non-rebindable old tab.
                    if (!drafts.get(`pm:${ref}`)) { app.pms.delete(ref); continue; }
                    view.open = false; view.lines = []; view.unread = 0; view.mentions = 0;
                    recoveryContexts.delete(view);
                }
                app.rooms = []; app.active = '#stalemate';
                app.away = false; app.ignores.clear(); app.peerIgnores.clear();
                app.restorePmOff = $('[data-pm-off]').checked;
                $('[data-pmreqs]').replaceChildren();
                $('[data-text]').value = drafts.get('#stalemate') || '';
            }
            send({ t: 'hello', nick, age13: true, entrySource: entrySharing.helloSource(), transport: 1 }); break;
        case 'person-preferences': acknowledgePersonPreferences(m); break;
        case 'game-room-open':
            if (gameOpenPending?.request === m.request) finishGameOpen(m);
            break;
        case 'entry-source': entrySharing.acknowledge(m); break;
        case 'nick-error':
            setConnection('offline'); gateStatus(m.text);
            $(gameGuest ? '[data-game-guest-connecting]' : '[data-gate]').hidden = false;
            $('[data-app]').hidden = true;
            break;
        case 'welcome': {
            if (!app.me || app.resetSession || app.verified !== (m.verified === true)) clearMessageRecovery();
            if (sharingControls) { $('.chat').insertBefore($('[data-sharing-controls]'), $('[data-lobby-welcome]')); $('[data-sharing-leave]').disabled = false; }
            const wasIn = !!app.me;
            if (!wasIn) count('lobby-join');
            app.verified = m.verified === true; app.capabilities = m.capabilities || app.capabilities;
            $('[data-room-filter] option[value=mine]').disabled = !app.verified;
            app.me = m.nick; app.selfId = personId(m.id) ? m.id : '';
            for (const view of app.pms.values()) updatePmName(view, view.nick);
            app.band = m.band; if (!gameGuest) writeRemembered('hangout-nick', m.nick);
            $('[data-self-nick]').textContent = m.nick;
            $('[data-self-role]').textContent = app.capabilities.configure ? 'Site administrator' : app.capabilities.moderate ? 'Community moderator' : app.verified ? 'Room owner account' : 'Guest access';
            app.kicked = false; retry = 0; setConnection('connected');
            entrySharing.joined();
            if (!gameGuest) returnToKeepRoom();
            if (arcadeResume) {
                if (arcadeTables.get(arcadeResume.game)?.supported && !app.sharingStopped && !pendingKeep &&
                    cmd('join', [arcadeResume.room], '#stalemate', arcadeResume.ref)) arcadeReturning = arcadeResume;
                arcadeResume = null;
            }
            followPendingRoomJoin();
            if (app.restorePmOff) { cmd('pm', ['off']); app.restorePmOff = false; }
            $('[data-gate]').hidden = true;
            if (gameGuest && !gameGuestSeated) gateStatus('Finding your seat…');
            else {
                $('[data-app]').hidden = false;
                $('[data-game-guest-connecting]').hidden = true;
            }
            if (!gameGuest && (!wasIn || app.resetSession)) {
                gameReturn = readGameReturn();
                gameReturnOffered = !!gameReturn;
                drawGameOffer();
            }
            if (wasIn && app.resetSession) {
                if (!gameGuest && !gameReturnOffered) toast('Connected. Room ownership and settings are kept; chat starts fresh. Choose a room to rejoin. Cameras stay off.');
            }
            else if (wasIn) line(app.active, { event: true, text: `* You are now ${m.nick}` });
            app.resetSession = false;
            document.body.classList.toggle('is-band', !!m.band);
            break;
        }
        case 'join': {
            const c = { ...m.ch, lines: [] };
            const gameOfferAccepted = joiningGameRoom === c.name;
            const invite = gameOfferAccepted ? joiningArcadeOffer : null;
            const returningToGame = gameReturnOffered && gameReturn?.room === c.name;
            const joiningLinkedGame = gameEntry?.target?.room === c.name;
            if (joiningLinkedGame) gameEntry = null;
            if (gameOfferAccepted) { joiningGameRoom = ''; joiningArcadeOffer = null; }
            if (returningToGame) gameReturnOffered = false;
            if (gameInvites.delete(c.name) || gameOfferAccepted || returningToGame || joiningLinkedGame) drawGameOffer();
            if (app.pendingChannel === m.ch.name) {
                app.pendingChannel = '';
                $('[data-channel-dialog]').close();
            }
            app.chans.set(m.ch.name, c);
            if (c.kind === 'game' && invite?.arcade && invite.ref === c.keepRef) beginArcadeInvitation(c, invite.arcade);
            if (gameGuest && gameGuest.game !== 'four' && c.name === gameGuest.room && c.keepRef === gameGuest.ref) beginArcadeInvitation(c, gameGuest);
            if (pendingKeep?.stage === 'joining' && c.name === pendingKeep.room) {
                if (c.keepRef === pendingKeep.ref) pendingKeep.stage = 'confirm';
                else clearKeep('That room changed while you signed in. Nothing was kept.');
            }
            // Classic IRC: joining begins a fresh buffer; never render pre-join backlog.
            if (activityRoom(c)) c.actSnap = activitySnapshot(m.act);
            switchTo(m.ch.name, { freshJoin: true });
            if (gameGuest?.game === 'four' && c.name === gameGuest.room && c.keepRef === gameGuest.ref) beginFourInvitation(c);
            if (gameOfferAccepted && !arcadeInvitation) focusChannelTab(c.name);
            followPendingRoomJoin();
            break;
        }
        case 'media-policy': {
            const c = app.chans.get(m.ch);
            if (!c || !Array.isArray(m.changes) || m.changes.length > 200) break;
            const members = new Set((c.names || []).map(member => member.id));
            const denied = new Set((Array.isArray(c.mediaBlocked) ? c.mediaBlocked : []).filter(id => members.has(id)));
            for (const change of m.changes) {
                if (!change || typeof change.id !== 'string' || typeof change.blocked !== 'boolean' || !members.has(change.id)) continue;
                if (change.blocked) denied.add(change.id); else denied.delete(change.id);
            }
            c.mediaBlocked = [...denied];
            const r = room();
            if (r) r.onChan(c);
            break;
        }
        case 'four': {
            const c = app.chans.get(m.ch);
            if (!fourInARowSupported || c?.kind !== 'game' || c.keepRef !== m.roomInstance) break;
            c.four = m.game;
            if (fourRoom === c) fourActionPending = false;
            if (app.active === c.name) drawGameNight();
            if (gameGuest?.game === 'four' && c.name === gameGuest.room) settleFourGuest(c);
            break;
        }
        case 'chan': {
            const c = app.chans.get(m.ch.name);
            if (c) {
                Object.assign(c, m.ch);
                const jamDraft = confirmJamShare(c);
                if (app.active === c.name) drawChan();
                // An own-share confirmation changes the room's invitation
                // context. Keep a newer edit through that synchronous redraw,
                // only while the same connected host still owns this editor.
                if (jamDraft && currentJam() === c && amOp(c)) $('[data-jam-link]').value = jamDraft;
                const r = room();
                if (r) r.onChan(c);
            }
            drawCommunity();
            break;
        }
        case 'act': {
            const c = app.chans.get(m.ch);
            if (!activityRoom(c)) break;
            cacheActivity(c, m);
            if (m.ch === app.active) room()?.onAct(m);
            // Observe relay time when received, never when a cached playing
            // video is selected later. Background activity creates no renderer.
            else roomApi?.observeTimestamp?.(m.ts);
            break;
        }
        case 'part': case 'closed': {
            if (gameGuest && m.ch === gameGuest.room) {
                leaveGameGuest(m.t === 'closed' ? 'closed' : gameGuestExit === 'removed' ? 'removed' : 'left');
                break;
            }
            const leavingGame = app.chans.get(m.ch)?.kind === 'game';
            const leavingFromButton = app.active === m.ch && document.activeElement === $('[data-leave]');
            forgetGameRoom(m.ch);
            app.chans.delete(m.ch);
            if (m.t === 'closed') toast(`${m.ch} was ${m.reason}.`);
            if (app.active === m.ch) switchTo('#stalemate');
            drawTabs();
            if ((leavingGame || leavingFromButton) && app.active === '#stalemate') focusChannelTab('#stalemate');
            break;
        }
        case 'line': pushLine(m.ch, m); break;
        case 'event': pushLine(m.ch, { ...m, event: true }); break;
        case 'notice':
            line(app.active, { notice: true, from: m.from, text: m.text, kind: m.kind });
            if (m.kind === 'error') {
                const failedGameJoin = !!joiningGameRoom;
                if (joiningGameRoom) {
                    const failedRoom = joiningGameRoom;
                    joiningGameRoom = '';
                    joiningArcadeOffer = null;
                    forgetGameRoom(failedRoom);
                    toast(jamRoomName(failedRoom) ? `Couldn’t join ${failedRoom}. It may have closed. Ask the host to invite you again.`
                        : 'Couldn’t join Game Night. Ask the host for a fresh invitation.');
                }
                if (fourActionPending) { fourActionPending = false; drawGameNight(); }
                const fourInviteFailed = gameGuest && !gameGuestSeated && arcadeInvitation?.game === 'four';
                if (fourInviteFailed) finishArcadeInvitation(m.text);
                if (personPreferencePending) { personPreferencePending = null; personSheetStatus('That preference was not confirmed. Check the current person and try again.'); }
                if (pendingKeep) clearKeep();
                resetPendingReports();
                if (app.pendingChannel && $('[data-channel-dialog]').open) {
                    $('[data-channel-error]').textContent = m.text;
                    app.pendingChannel = '';
                } else if (!failedGameJoin && !fourInviteFailed) toast(m.text);
            }
            break;
        case 'denied': if (personPreferencePending) { personPreferencePending = null; personSheetStatus('That preference was not confirmed. Check the current person and try again.'); } if (pendingKeep) clearKeep(); if (fourActionPending) { fourActionPending = false; drawGameNight(); } line(app.active, { notice: true, from: 'StaleBot', text: m.text, kind: 'error' }); break;
        case 'list': app.rooms = m.rooms; drawRooms(); if (m.show) show('rooms'); break;
        case 'delete': for (const c of [...app.chans.values(), ...app.pms.values()]) c.lines = c.lines.filter((l) => !m.ids.includes(l.id)); $$('[data-id]').forEach((li) => { if (m.ids.includes(li.dataset.id)) li.remove(); }); break;
        case 'pm-request': pmRequest(m); break;
        case 'pm-request-ended': clearPmRequest(m); if (m.reason) toast(m.reason); break;
        case 'pm-open': openPm(m, true); break;
        case 'pm-peer': {
            const view = pmFrameView(m);
            if (view?.open) { updatePmName(view, m.with); drawTabs(); if (store(app.active) === view) drawChan(); drawMessageRecovery(); }
            break;
        }
        case 'pm-closed': {
            const previous = pmFrameView(m);
            if (previous) { previous.open = false; recoveryContexts.delete(previous); drawTabs(); if (store(app.active) === previous) { drawChan(); pmDraftNotice(previous); } else toast(`PM with ${previous.nick} closed. Your draft stays in this tab.`); }
            clearPmRequest(m); drawMessageRecovery(); break;
        }
        case 'pm': {
            const other = privateMessagePeersSupported ? m.with : m.from === app.me ? m.to : m.from;
            const view = openPm({ ...m, with: other }, false, false);
            if (view) pushLine(`pm:${view.ref}`, { ...m, ch: `pm:${view.ref}` }); break;
        }
        case 'pm-setting': $('[data-pm-off]').checked = m.off; toast(m.text); break;
        case 'invite':
            if (jamRoomName(m.ch) || gameNightSupported && gameNightRoomName(m.ch) && roomNonce(m.roomInstance)) {
                if (!app.chans.has(m.ch)) {
                    if (!gameInvites.has(m.ch) && gameInvites.size === 5 && !joiningGameRoom)
                        gameInvites.delete(gameInvites.keys().next().value);
                    if (gameInvites.has(m.ch) || gameInvites.size < 5) {
                        const arcade = gameNightRoomName(m.ch) && arcadeTables.get(m.arcade?.game)?.supported
                            ? gameNightInvite(m.arcade.game, m.arcade.match) : null;
                        gameInvites.set(m.ch, { room: m.ch, ref: roomNonce(m.roomInstance) ? m.roomInstance : undefined, by: m.by, arcade });
                    }
                    drawGameOffer();
                }
            } else toast(`${m.by} invited you to ${m.ch}`, [['Join', () => cmd('join', [m.ch])]]);
            break;
        case 'kicked': {
            if (gameGuest && m.ch === gameGuest.room) { gameGuestExit = 'removed'; break; }
            forgetGameRoom(m.ch);
            app.kicked = m.ch === '#stalemate';
            toast(`${m.banned ? 'Banned' : 'Kicked'} from ${m.ch} by ${m.by}: ${m.reason}`);
            if (app.kicked) {
                clearGameLinks();
                clearJamInvitations();
                $('[data-gate]').hidden = false; $('[data-app]').hidden = true; gateStatus(`You got the boot (${m.reason}). Take a breather.`);
            } else {
                app.chans.delete(m.ch);
                if (app.active === m.ch) switchTo('#stalemate');
                drawTabs();
            }
            break;
        }
        case 'cam': {
            const c = app.chans.get(m.ch);
            if (c) c.myCam = m.on;
            if (app.active === m.ch) drawChan();
            const r = room();
            if (r) r.onCam(m.ch, m.on);
            if (m.by && !m.on) toast(`Camera switched off by ${m.by}.`);
            break;
        }
        case 'cam-gate': if (!app.localMediaPaused) $('[data-cam-gate]').showModal(); break;
        case 'net':
            app.netLock = m.lock; shieldActive = m.shield === true;
            if (shieldActive) clearGameLinks(); else drawGameNight();
            drawCommunity(); if (m.shield) toast('🛡️ Shield’s up: slow mode, cameras off for a bit.'); break;
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
    function revealFocusedReport(button) {
        if (document.activeElement !== button) return;
        requestAnimationFrame(() => {
            if (document.activeElement === button && button.matches(':focus-visible')) {
                button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
        });
    }
    function finishReport(id, submitted) {
        const pending = pendingReports.get(id);
        if (pending) { clearTimeout(pending.timer); pendingReports.delete(id); }
        if (submitted) for (const c of [...app.chans.values(), ...app.pms.values()]) {
            const l = c.lines.find((line) => line.id === id); if (l) l.reported = true;
        }
        const button = pending?.button || $$('[data-id]').find((line) => line.dataset.id === id)?.querySelector('.flag');
        if (button) {
            if (submitted) {
                button.setAttribute('aria-disabled', 'true');
                button.tabIndex = -1;
            } else {
                button.removeAttribute('aria-disabled');
                button.tabIndex = 0;
            }
            button.textContent = submitted ? '✓' : '🚩';
            button.title = submitted ? REPORT_QUEUED_LABEL : 'Report this message';
            if (submitted) button.setAttribute('aria-label', REPORT_QUEUED_LABEL);
            revealFocusedReport(button);
        }
    }
    function resetPendingReports() { for (const id of [...pendingReports.keys()]) finishReport(id, false); }
    function appendLine(l) {
        const buf = $('[data-buffer]');
        const lines = $('[data-chat-lines]');
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
            if (l.t === 'pm') {
                // Historical display names never select a new live endpoint.
                who.disabled = l.self !== false || !pmFrameValid(l);
                if (!who.disabled) who.addEventListener('click', () => nickSheet(l.from, l));
            } else {
                const context = personContext(l.personPeer, l.ch, l.roomInstance, l.from);
                who.disabled = l.personSelf !== false || !personContextValid(context);
                if (!who.disabled) who.addEventListener('click', () => nickSheet(l.from, { ...context, message: l }));
            }
            li.append(who);
            const entryText = entryBadge(l.entrySource, entrySites);
            if (entryText) { const entry = document.createElement('span'); entry.className = 'entry-badge'; entry.textContent = entryText; li.append(' ', entry); }
            if (l.moderator) { const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = 'MOD'; li.append(' ', badge); }
            if (l.band) { const s = document.createElement('span'); s.className = 'badge'; s.textContent = '⭐ BAND'; li.append(' ', s); }
            li.append(' ', l.text);
            if (l.id && (l.t === 'pm' ? l.self !== true : l.personSelf !== true)) {
                const r = document.createElement('button'); r.type = 'button'; r.className = 'flag'; r.textContent = '🚩'; r.setAttribute('aria-label', `Report this message from ${l.from}`);
                if (l.reported) { r.setAttribute('aria-disabled', 'true'); r.tabIndex = -1; r.textContent = '✓'; r.title = REPORT_QUEUED_LABEL; r.setAttribute('aria-label', REPORT_QUEUED_LABEL); }
                else if (pendingReports.has(l.id)) { r.setAttribute('aria-disabled', 'true'); r.textContent = '…'; pendingReports.get(l.id).button = r; }
                r.addEventListener('focus', () => revealFocusedReport(r));
                r.addEventListener('click', () => {
                    if (l.reported || pendingReports.has(l.id)) return;
                    if (!send({ t: 'report', id: l.id, text: l.text })) return toast('You are offline. Reconnect before reporting this message.');
                    r.setAttribute('aria-disabled', 'true'); r.textContent = '…';
                    const timer = setTimeout(() => { finishReport(l.id, false); toast('Report confirmation did not arrive. Try again or use the moderation contact.'); }, 10000);
                    pendingReports.set(l.id, { button: r, timer });
                });
                li.append(r);
            }
            if (l.me) li.classList.add('act');
        }
        const stick = buf.scrollHeight - buf.scrollTop - buf.clientHeight < 60;
        lines.append(li);
        while (lines.children.length > 300) lines.firstChild.remove();
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

    function switchTo(key, { freshJoin = false } = {}) {
        const prev = app.active;
        if (prev !== key) { drafts.set(prev, $('[data-text]').value); $('[data-text]').value = drafts.get(key) || ''; }
        app.active = key;
        const c = store(key);
        if (c?.kind === 'game' || c?.kind === 'jam') rememberGameReturn(c);
        if (c) { c.unread = 0; c.mentions = 0; }
        belowFold = 0; drawNewMessages(); replaying = true;
        announcements.replace(() => {
            $('[data-chat-lines]').replaceChildren();
            (c ? c.lines : []).forEach(appendLine);
        });
        replaying = false;
        drawTabs(); drawChan(); drawMessageRecovery();
        drawCommunity(); drawRooms();
        show('chat');
        const buf = $('[data-buffer]'); buf.scrollTop = buf.scrollHeight;
        const r = room();
        if (r) {
            if ((prev !== key || freshJoin) && c && c.kind !== 'lobby' && c.kind !== 'jam') r.onJoin(c, c.actSnap);
            else if (!c || c.kind === 'lobby' || c.kind === 'jam') r.onLeave();
        }
    }

    function drawTabs() {
        const nav = $('[data-tabs]');
        const focusKey = nav.contains(document.activeElement) ? document.activeElement.dataset.channelKey : null;
        nav.replaceChildren();
        let totalUnread = 0;
        const mk = (key, label, unread, mentions, title) => {
            const b = document.createElement('button');
            b.type = 'button'; b.role = 'tab'; b.textContent = unread ? `${label} (${unread}${mentions ? ' · @you' : ''})` : label;
            b.dataset.channelKey = key;
            if (title) b.title = title;
            b.setAttribute('aria-selected', String(app.active === key));
            b.tabIndex = app.active === key ? 0 : -1;
            b.classList.toggle('has-mention', !!mentions);
            totalUnread += unread || 0;
            b.addEventListener('click', () => switchTo(key));
            nav.append(b);
        };
        const gameRooms = [...app.chans.values()].filter(c => c.kind === 'game');
        for (const c of app.chans.values()) {
            if (c.kind === 'game') {
                const label = gameRooms.length === 1 ? 'Game Night' : `Game Night ${gameRooms.indexOf(c) + 1}`;
                mk(c.name, label, c.unread, c.mentions, c.name);
            } else mk(c.name, `${KIND_ICON[c.kind] === '#' ? '' : `${KIND_ICON[c.kind]} `}${c.name}`, c.unread, c.mentions);
        }
        for (const [ref, p] of app.pms) mk(`pm:${ref}`, `✉ ${p.nick}${p.open ? '' : ' (closed)'}`, p.unread, p.mentions);
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
    function clearPendingJamShare() {
        clearTimeout(jamShareTimer); pendingJamShare = null;
        $('[data-jam-form] button[type="submit"]').disabled = false;
    }
    function waitForJamShare(pending) {
        clearTimeout(jamShareTimer);
        $('[data-jam-form] button[type="submit"]').disabled = true;
        $('[data-jam-share-status]').textContent = 'Waiting for confirmation. You can edit the next paste.';
        jamShareTimer = setTimeout(() => {
            if (pendingJamShare === pending && currentJam() === pending.room && amOp(pending.room))
                $('[data-jam-share-status]').textContent = 'Still waiting. Your edit is kept; copy it before leaving or reconnecting.';
        }, Math.max(0, pending.deadline - Date.now()));
    }
    function jamShareResult(frame) {
        const pending = pendingJamShare;
        if (!jamShareResultsSupported || !pending?.requestId || frame.id !== pending.requestId
            || !['published', 'rejected'].includes(frame.status) || pending.context !== jamContext
            || currentJam() !== pending.room || !amOp(pending.room)) return;
        if (frame.status === 'published' && pending.confirmed && $('[data-jam-link]').value === pending.value) $('[data-jam-link]').value = '';
        clearPendingJamShare();
        $('[data-jam-share-status]').textContent = frame.status === 'rejected' ? 'Share rejected. Edit the paste and try again.'
            : pending.confirmed ? 'Invitation shared.' : 'The result arrived without matching room state. Your paste is kept.';
    }
    function resetJamControls() {
        clearPendingJamShare();
        $('[data-jam-share-status]').textContent = '';
        $('[data-jam]').hidden = true;
        const desktop = $('[data-jam-desktop]'); desktop.hidden = true; desktop.removeAttribute('href');
        $('[data-jam-copy]').hidden = true;
        $('[data-jam-copy-fallback]').hidden = true; $('[data-jam-copy-value]').value = '';
        $('[data-jam-invite-copy]').hidden = true;
        $('[data-jam-invite-copy-fallback]').hidden = true; $('[data-jam-invite-copy-value]').value = '';
        $('[data-jam-invite-qr-toggle]').hidden = true;
        $('[data-jam-invite-qr-panel]').hidden = true;
        clearJamInviteQr();
        $('[data-jam-invite-qr-toggle]').setAttribute('aria-expanded', 'false');
        $('[data-jam-invite-qr-toggle]').textContent = 'Show QR code';
        $('[data-jam-link]').value = ''; $('[data-jam-form]').hidden = true;
        $('[data-jam-host-steps]').hidden = true;
        $('[data-jam-invite-room]').hidden = true;
        $('[data-jam-wait]').hidden = false;
        const web = $('[data-jam-web]'); web.disabled = true; web.onclick = null; web.textContent = 'Browser join unavailable';
    }
    function browserInviteLink(context) {
        return context?.webReady && /^https:\/\//.test(context.web) ? context.web : '';
    }
    function followPendingRoomJoin() {
        const room = app.pendingRoomJoin;
        if (!room || connectionState !== 'connected' || sessionEnded || app.localMediaPaused || app.sharingStopped) return;
        app.pendingRoomJoin = '';
        cmd('join', [room]);
    }
    function focusChannelTab(key, { preventScroll = true } = {}) {
        const tab = $$('[data-tabs] [data-channel-key]').find(tab => tab.dataset.channelKey === key);
        tab?.focus({ preventScroll });
        if (document.activeElement !== tab) $('.phonetabs [aria-current="true"]')?.focus({ preventScroll });
    }
    function readGameReturn() {
        let saved = gameReturn;
        if (!saved) {
            try { saved = JSON.parse(readTab(gameReturnKey)); } catch { /* Ignore stale tab data. */ }
        }
        if (saved?.room && offerRoomName(saved.room) && roomNonce(saved.ref) && saved.until > Date.now()) return saved;
        removeTab(gameReturnKey);
        return null;
    }
    function rememberGameReturn(room) {
        if (!offerRoomName(room.name) || !roomNonce(room.keepRef)) return;
        // Tab-local room reference only. Admission, nicknames and match state stay elsewhere.
        gameReturn = { room: room.name, ref: room.keepRef, until: Date.now() + 30 * 60 * 1000 };
        writeTab(gameReturnKey, JSON.stringify(gameReturn));
    }
    function clearGameReturn() {
        gameReturn = null; gameReturnOffered = false;
        removeTab(gameReturnKey);
    }
    function forgetGameRoom(name) {
        const removed = gameInvites.delete(name);
        const linked = gameEntry?.target?.room === name;
        if (linked) gameEntry = null;
        if (gameReturn?.room === name) { clearGameReturn(); drawGameOffer(); }
        else if (removed || linked) drawGameOffer();
    }
    function currentGameOffer() {
        return gameReturnOffered ? gameReturn : gameInvites.values().next().value || (gameNightSupported ? gameEntry?.target : null);
    }
    function finishGameOpen(result) {
        const pending = gameOpenPending;
        if (!pending) return;
        clearTimeout(pending.timer);
        gameOpenPending = null;
        const room = result?.ok && store(result.room);
        if (room?.kind === 'game' && room.keepRef === result.ref) {
            const requestedGame = pending.fromEntry && gameEntry?.table;
            if (arcadeTables.get(requestedGame)?.supported) {
                arcadeReturning = { room: room.name, ref: room.keepRef, game: requestedGame };
                arcadeShareIntent = gameEntry.prepareShare && gameGuestInvitesSupported ? arcadeReturning : null;
            }
            if (pending.fromEntry) gameEntry = null;
            if (app.active !== room.name) switchTo(room.name);
            else if (arcadeReturning) drawGameNight();
        } else {
            gameOpenError = 'Couldn’t open Game Night. Try again or return to your room from the room list.';
            if (!pending.fromEntry) toast(gameOpenError);
        }
        drawGameOffer();
    }
    function openGameRoom(fromEntry = false) {
        if (gameOpenPending) return;
        const request = newGameNightRoomName();
        count('room-start-game');
        if (!gameOpenSupported) {
            if (fromEntry) { gameEntry = null; drawGameOffer(); }
            cmd('join', [request]);
            return;
        }
        gameOpenError = '';
        if (!cmd('gameopen', [request])) { toast('Reconnect before opening Game Night.'); return; }
        gameOpenPending = { request, fromEntry, timer: setTimeout(() => finishGameOpen(null), 8000) };
        drawGameOffer();
    }
    function drawGameOffer() {
        const offer = currentGameOffer();
        const start = !offer && gameNightSupported && gameEntry && !gameEntry.target && connectionState === 'connected' && !app.sharingStopped;
        const panel = $('[data-game-offer]'), status = $('[data-game-offer-status]');
        const button = $('[data-game-offer-join]');
        const hadFocus = panel.contains(document.activeElement);
        panel.hidden = !offer && !start;
        if (panel.hidden) {
            status.textContent = '';
            if (hadFocus) focusChannelTab(app.active);
            return;
        }
        const jam = jamRoomName(offer?.room);
        const roomLabel = jam ? offer.room : 'Game Night';
        const gameLabel = arcadeTables.get(offer?.arcade?.game)?.label;
        const selectedGame = arcadeTables.get(gameEntry?.table)?.label;
        let message;
        if (start) message = gameOpenPending ? 'Opening Game Night…' : gameOpenError || (selectedGame
            ? `Start a private Game Night for ${selectedGame}.` : 'Start a private Game Night or wait for your host’s invitation.');
        else if (joiningGameRoom === offer.room) message = `Joining ${roomLabel}…`;
        else if (gameReturnOffered) {
            message = jam ? `You were disconnected from ${offer.room}. Chat starts fresh.`
                : 'Game Night disconnected. Return to the room to check your match.';
        } else if (offer.by) message = gameLabel ? `${offer.by} invited you to play ${gameLabel}.` : `${offer.by} invited you to ${roomLabel}.`;
        else message = 'Your link points to a private Game Night. The host’s invitation is required.';
        if (status.textContent !== message) status.textContent = message;
        button.textContent = start ? 'Start Game Night' : gameReturnOffered ? 'Return to room'
            : gameLabel ? `Play ${gameLabel}` : jam ? 'Join room' : 'Join Game Night';
        const busy = !!joiningGameRoom || start && !!gameOpenPending;
        button.setAttribute('aria-disabled', String(busy));
        $('[data-game-offer-dismiss]').disabled = busy;
    }
    $('[data-game-offer-join]').addEventListener('click', () => {
        const offer = currentGameOffer();
        if (joiningGameRoom || connectionState !== 'connected' || sessionEnded || app.sharingStopped) return;
        if (!offer) {
            if (!gameNightSupported || !gameEntry || gameEntry.target) return;
            return openGameRoom(true);
        }
        if (!cmd('join', [offer.room], app.active, offer.ref)) {
            return toast(jamRoomName(offer.room) ? 'Reconnect before joining the room.' : 'Reconnect before joining Game Night.');
        }
        joiningGameRoom = offer.room;
        joiningArcadeOffer = offer.arcade ? offer : null;
        drawGameOffer();
    });
    $('[data-game-offer-dismiss]').addEventListener('click', () => {
        const offer = currentGameOffer();
        if (offer && !joiningGameRoom) forgetGameRoom(offer.room);
        else if (!offer && gameEntry) { gameEntry = null; drawGameOffer(); }
    });
    window.addEventListener('pagehide', () => {
        const c = app.chans.get(gameReturn?.room);
        if (connectionState === 'connected' && (c?.kind === 'game' || c?.kind === 'jam')) rememberGameReturn(c);
    });
    function clearJamInviteQr() {
        const canvas = $('[data-jam-invite-qr]');
        canvas.width = canvas.width; // Reset the backing bitmap and drawing state.
        canvas.removeAttribute('data-invite-url');
    }
    function drawJamInviteQr(link) {
        clearJamInviteQr();
        const canvas = $('[data-jam-invite-qr]');
        if (!link || !window.HangoutQrLite?.draw) { canvas.removeAttribute('data-invite-url'); return; }
        window.HangoutQrLite.draw(canvas, link);
    }
    function clearJamInvitations() {
        // A disconnected tab has no current room admission. Purge cached
        // capabilities too, so selecting an old tab cannot reveal them again.
        for (const c of app.chans.values()) if (c.kind === 'jam') c.jam = null;
        jamContext = null;
        resetJamControls();
    }
    function currentJam() {
        const c = app.chans.get(app.active);
        return connectionState === 'connected' && !app.localMediaPaused && !app.sharingStopped
            && c?.kind === 'jam' && c.names?.some(n => n.nick === app.me) ? c : null;
    }
    function confirmJamShare(c) {
        const pending = pendingJamShare;
        if (pending?.requestId) return; // Correlated feedback, not a state echo, completes this request.
        if (!pending || pending.room !== c || pending.context !== jamContext || currentJam() !== c || !amOp(c)) return;
        const confirmed = pending.web ? c.jam?.web : c.jam?.invitation || c.jam?.desktop;
        if (confirmed !== pending.sharedValue) return;
        const input = $('[data-jam-link]');
        const newerDraft = input.value === pending.value ? '' : input.value;
        if (input.value === pending.value) input.value = '';
        pendingJamShare = null;
        return newerDraft;
    }
    function drawJam() {
        if (app.sharingStopped || app.localMediaPaused) { resetJamControls(); $('[data-jam]').hidden = true; return; }
        const c = currentJam();
        const next = c ? { room: c, host: !!amOp(c), invitation: c.jam?.invitation || c.jam?.desktop || '',
            desktop: c.jam?.desktop || '', web: c.jam?.web || '', webReady: c.jam?.webReady === true } : null;
        const unchanged = jamContext && next && Object.keys(next).every(key => next[key] === jamContext[key]);
        const pending = pendingJamShare;
        const ownPublication = pending?.requestId && pending.room === c && pending.context === jamContext && next?.host
            && (pending.web ? next.web : next.invitation) === pending.sharedValue;
        if (ownPublication) pending.confirmed = true;
        // The shared host editor belongs to one room and current authority.
        // Presence redraws keep it; switching, replacement or power loss clears it.
        if (!unchanged) {
            const draft = ownPublication ? $('[data-jam-link]').value : '';
            resetJamControls(); jamContext = next;
            if (ownPublication) {
                pending.context = jamContext; pendingJamShare = pending;
                $('[data-jam-link]').value = draft; waitForJamShare(pending);
            }
        }
        if (!next) return;
        $('[data-jam]').hidden = false; $('[data-jam-form]').hidden = !next.host;
        $('[data-jam-invite-room]').hidden = !next.host;
        const desktop = $('[data-jam-desktop]');
        desktop.hidden = !next.desktop;
        if (/^webjam:\/\//.test(next.desktop)) desktop.setAttribute('href', next.desktop);
        else desktop.removeAttribute('href');
        const shared = !!(next.invitation || next.webReady);
        $('[data-jam-host-steps]').hidden = !next.host || shared;
        $('[data-jam-actions]').hidden = next.host && !shared;
        $('[data-jam-wait]').hidden = shared; $('[data-jam-copy]').hidden = !next.invitation;
        const browserLink = browserInviteLink(next);
        $('[data-jam-invite-copy]').hidden = !browserLink;
        $('[data-jam-invite-qr-toggle]').hidden = !browserLink;
        if (!browserLink) {
            clearJamInviteQr();
            $('[data-jam-invite-qr-panel]').hidden = true;
            $('[data-jam-invite-qr-toggle]').setAttribute('aria-expanded', 'false');
            $('[data-jam-invite-qr-toggle]').textContent = 'Show QR code';
        } else if (!$('[data-jam-invite-qr-panel]').hidden) drawJamInviteQr(browserLink);
        const web = $('[data-jam-web]'); web.disabled = !next.webReady;
        web.textContent = web.disabled ? 'Browser join unavailable' : 'Join in browser';
        web.title = web.disabled ? 'Your host has not shared an approved browser invite yet' : 'Open the host’s browser invitation; headphones and audio consent are required there';
        const context = jamContext;
        web.onclick = () => {
            if (jamContext === context && currentJam() === context.room && context.webReady && /^https:\/\//.test(context.web))
                window.open(context.web, '_blank', 'noopener,noreferrer');
        };
    }
    function currentGameNight() {
        const c = app.chans.get(app.active);
        return gameNightSupported && connectionState === 'connected' && !app.sharingStopped && !app.localMediaPaused
            && c?.kind === 'game' && c.names?.some(member => member.id === app.selfId) ? c : null;
    }
    function clearGameLinks() {
        for (const c of app.chans.values()) if (c.kind === 'game') { c.gameCall = ''; c.four = null; }
        drawGameNight();
    }
    function drawGameNight() {
        const c = currentGameNight();
        if (arcadeInvitation && c?.keepRef !== arcadeInvitation.ref) finishArcadeInvitation();
        const canCall = !gameGuest && discordLinksSupported && !shieldActive;
        const canManage = c && canCall && amOp(c) && roomNonce(c.keepRef);
        const editor = $('[data-game-editor]');
        if (gameEditorRoom !== (canManage ? c : null)) {
            gameEditorRoom = canManage ? c : null;
            editor.open = false;
            $('[data-game-form]').reset();
            $('[data-game-error]').textContent = '';
        }
        const link = canCall ? discordCallLink(c?.gameCall) : '';
        const input = $('[data-game-link]');
        if (canManage && link && discordCallLink(input.value) === link) input.value = '';
        const open = $('[data-game-open]');
        if (link) open.href = link; else open.removeAttribute('href');
        open.hidden = !link;
        const status = $('[data-game-call-status]');
        const guidance = !c ? '' : link ? 'Voice and video open in Discord. Hang Out chat stays here.'
            : canCall ? 'Voice and video are optional. A host can share a Discord call link.' : 'Discord calls are unavailable in this session. You can still play and chat.';
        if (status.textContent !== guidance) status.textContent = guidance;
        editor.hidden = !canManage;
        $('[data-game-clear]').hidden = !link;
        $('[data-game-invite]').hidden = !c || !amOp(c);
        const canShare = betaShell && gameNightFragment && c && amOp(c) && roomNonce(c.keepRef);
        if (gameShareButton) gameShareButton.hidden = !canShare;
        if (gameShareDialog?.open && (!canShare || gameShareDialog.dataset.room !== c.keepRef)) gameShareDialog.close();
        $('[data-game-night]').hidden = !c;
        $('[data-arcade-game]').hidden = !!gameGuest || !c || ![...arcadeTables.values()].some(table => table.supported);
        drawFour(c);
        for (const [game, table] of arcadeTables) drawArcadeTable(c, game, table);
        drawArcadeMedia(c);
    }
    function drawArcadeMedia(c) {
        const scope = arcadeMediaSupported && !shieldActive && c && roomNonce(c.keepRef)
            ? { actor: app.selfId, room: c.name, ref: c.keepRef } : null;
        if (arcadeMedia) {
            arcadeMedia.setRoom(scope);
            return;
        }
        if (!scope || arcadeMediaLoading) return;
        arcadeMediaLoading = true;
        import('./game-night-call.mjs').then(module => {
            arcadeMedia = module.mountGameNightCall($('#game-night-call'), $('[data-call-toggle]'), {
                personActions(peer) {
                    const room = currentGameNight(), target = room?.names?.find(person => person.id === peer);
                    if (target) nickSheet(target.nick, personContext(peer, room.name, room.keepRef, target.nick));
                }
            });
            drawArcadeMedia(currentGameNight());
        }).catch(() => toast('Call controls could not load. Reopen Game Night to try again.'))
            .finally(() => { arcadeMediaLoading = false; });
    }
    function drawArcadeTable(c, game, table) {
        const scope = table.supported && (!gameGuest || gameGuest.game === game) && !shieldActive && c && roomNonce(c.keepRef)
            ? { actor: app.selfId, room: c.name, ref: c.keepRef } : null;
        const option = $(`[data-arcade-game] option[value="${game}"]`);
        option.hidden = option.disabled = !scope || !table.controller;
        if (table.controller) {
            table.controller.setRoom(scope);
            updateTableInvite(table, c);
            if (scope && arcadeInvitation?.game === game && arcadeInvitation.ref === scope.ref) table.controller.open();
            if (scope && game === arcadeReturning?.game && scope.room === arcadeReturning.room && scope.ref === arcadeReturning.ref) {
                arcadeReturning = null;
                table.controller.open();
            }
            return;
        }
        if (!scope || table.loading) return;
        table.loading = true;
        table.load().then(mount => {
            table.controller = mount($('[data-game-night]'), (room, state, sendMatch) => arcadeMatchState(game, table, room, state, sendMatch));
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn btn--small arcade-invite-friend';
            button.textContent = 'Invite a friend';
            button.setAttribute('aria-haspopup', 'dialog');
            button.hidden = true;
            button.addEventListener('click', () => {
                if (table.invite && arcadeInviteTarget() === table.invite) openInviteDialog(button);
            });
            table.controller.panel.querySelector('summary').nextElementSibling.after(button);
            table.inviteButton = button;
            drawArcadeTable(currentGameNight(), game, table);
        }).catch(() => {
            if (gameGuest && !gameGuestSeated) {
                finishArcadeInvitation();
                offerGameGuestReload(`${table.label} could not load. Try again.`);
            } else toast(`${table.label} could not load. Reopen Game Night to try again.`);
        })
            .finally(() => { table.loading = false; });
    }
    function beginArcadeInvitation(room, target) {
        finishArcadeInvitation();
        arcadeInvitation = { ...target, room: room.name, ref: room.keepRef, sent: false,
            timer: setTimeout(() => {
                if (gameGuest && !gameGuestSeated) offerGameGuestReload('Still waiting for your seat. Try again.');
                else finishArcadeInvitation('The seat could not be confirmed. Ask the host for a fresh game invitation.');
            }, 15000) };
    }
    function offerGameGuestReload(message) {
        gateStatus(message);
        const retryGame = $('[data-game-guest-retry]');
        retryGame.hidden = false;
        if (!gameGuestReloadOffered) retryGame.focus({ preventScroll: true });
        gameGuestReloadOffered = true;
    }
    function finishArcadeInvitation(message) {
        clearTimeout(arcadeInvitation?.timer);
        arcadeInvitation = null;
        if (message) {
            if (gameGuest && !gameGuestSeated) {
                gameGuestReloadOffered = false;
                $('[data-game-guest-retry]').hidden = true;
                gateStatus(message);
            } else toast(message);
        }
    }
    function revealFourGuest() {
        gameGuestSeated = true;
        gameGuestReloadOffered = false;
        $('[data-game-guest-retry]').hidden = true;
        $('[data-app]').hidden = false;
        $('[data-game-guest-connecting]').hidden = true;
        const detail = $('[data-four]');
        detail.hidden = false;
        detail.open = true;
        detail.querySelector('summary')?.focus({ preventScroll: true });
        requestAnimationFrame(() => {
            $('[data-four-columns]')?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        });
    }
    function settleFourGuest(room) {
        if (!gameGuest || gameGuest.game !== 'four' || gameGuestSeated) return;
        const invite = arcadeInvitation;
        if (!invite || invite.game !== 'four' || room?.name !== invite.room || room.keepRef !== invite.ref) return;
        const game = room.four;
        if (!game) return;
        if (game.guest === app.selfId && game.id === gameGuest.match) {
            revealFourGuest();
            return finishArcadeInvitation();
        }
        if (game.id !== gameGuest.match || game.guest) {
            return finishArcadeInvitation('This game invitation no longer has an open seat. Ask the host for a fresh invitation.');
        }
        if (!invite.sent) invite.sent = fourCommand('join') === true;
    }
    function beginFourInvitation(room) {
        finishArcadeInvitation();
        arcadeInvitation = { game: 'four', match: gameGuest.match, room: room.name, ref: room.keepRef, sent: false,
            timer: setTimeout(() => {
                if (gameGuest && !gameGuestSeated) offerGameGuestReload('Still waiting for your seat. Try again.');
            }, 15000) };
        settleFourGuest(room);
    }
    function updateTableInvite(table, room) {
        if (table.inviteButton)
            table.inviteButton.hidden = !!gameGuest || !gameGuestInvitesSupported || !table.invite || !room || !amOp(room);
    }
    function arcadeMatchState(game, table, scope, state, sendMatch) {
        table.invite = scope && state?.seat && state.waiting && state.hasOpenSeat !== false ? gameNightInvite(game, state.id) : null;
        updateTableInvite(table, currentGameNight());
        const share = arcadeShareIntent;
        if (share && table.invite && table.controller?.isOpen() && scope.room === share.room && scope.ref === share.ref && game === share.game) {
            arcadeShareIntent = null;
            const room = currentGameNight();
            if (room?.keepRef === share.ref && amOp(room) && !document.querySelector('dialog[open]')) {
                openInviteDialog(null, table.invite);
                if ($('[data-invite-dialog]').open) void prepareGuestLink(table.invite, true);
            }
        }
        const invite = arcadeInvitation;
        if (!sendMatch || !invite || game !== invite.game || scope?.room !== invite.room || scope.ref !== invite.ref) return;
        if (state?.seat && (state.id === invite.match || gameGuest)) {
            if (gameGuest && !gameGuestSeated) {
                gameGuestSeated = true;
                gameGuestReloadOffered = false;
                $('[data-game-guest-retry]').hidden = true;
                $('[data-app]').hidden = false;
                $('[data-game-guest-connecting]').hidden = true;
                table.controller.panel.querySelector('summary').focus({ preventScroll: true });
            }
            return finishArcadeInvitation();
        }
        if (state?.id !== invite.match || !state.waiting || state.hasOpenSeat === false) {
            return finishArcadeInvitation('This game invitation no longer has an open seat. Ask the host for a fresh invitation.');
        }
        if (!invite.sent) invite.sent = sendMatch({ action: 'join', id: invite.match, seat: 'next' });
    }
    $('[data-arcade-game]').addEventListener('change', event => {
        const game = event.target.value;
        event.target.value = '';
        if (!currentGameNight() || !game) return;
        const four = game === 'four' ? $('[data-four]:not([hidden])') : null;
        const controller = arcadeTables.get(game)?.controller;
        const wasOpen = four?.open || controller?.isOpen();
        const panel = four || controller?.open();
        if (!panel) return;
        if (four) four.open = true;
        const heading = panel.querySelector('summary');
        heading.focus({ preventScroll: true });
        const reveal = () => {
            const target = panel.offsetHeight < panel.parentElement.clientHeight ? panel : heading;
            target.scrollIntoView({ block: 'center', behavior: 'instant' });
        };
        reveal();
        // Some games reset the scroll position as their panel opens.
        if (!wasOpen) panel.addEventListener('toggle', () => {
            if (panel.open && document.activeElement === heading) reveal();
        }, { once: true });
        // The start controls can appear after the match service responds.
        const resize = new ResizeObserver(() => {
            if (panel.open && document.activeElement === heading) reveal();
        });
        resize.observe(panel);
        heading.addEventListener('blur', () => resize.disconnect(), { once: true });
    });
    window.addEventListener('pagehide', () => {
        const current = currentGameNight();
        const open = [...arcadeTables].find(([, table]) => table.controller?.isOpen());
        if (gameGuest || !current || !open) return;
        const intent = keepRoomIntent(current);
        if (intent) writeTab(ARCADE_RESUME_KEY, JSON.stringify({ intent, game: open[0], entry: entryHandoff(entrySource, shareEntry, Date.now(), entrySites) }));
    });
    function fourCommand(action, column) {
        const c = currentGameNight();
        if (!c || c !== fourRoom || shieldActive || !roomNonce(c.keepRef)) return false;
        const primary = action === 'open' || action === 'join';
        if (primary && fourActionPending) return false;
        const game = c.four;
        const args = [action, game?.id || ''];
        if (action === 'drop') args.push(String(game.moves), String(column + 1));
        if (!cmd('four', args, c.name, c.keepRef)) {
            toast('Reconnect before playing.');
            return false;
        }
        if (primary) {
            fourActionPending = true;
            $('[data-four-action]').setAttribute('aria-disabled', 'true');
        }
        return true;
    }
    function buildFourBoard() {
        for (let column = 0; column < FOUR_COLUMNS; column++) {
            const b = document.createElement('button');
            b.className = 'btn btn--small btn--ghost'; b.type = 'button';
            b.textContent = column + 1;
            b.setAttribute('aria-label', `Drop in column ${column + 1}`);
            b.addEventListener('click', () => {
                if (b.getAttribute('aria-disabled') === 'false') fourCommand('drop', column);
            });
            fourButtons.push(b);
        }
        $('[data-four-columns]').append(...fourButtons);
        const body = $('[data-four-table]').createTBody();
        for (let row = 0; row < FOUR_ROWS; row++) {
            const line = body.insertRow();
            for (let column = 0; column < FOUR_COLUMNS; column++) {
                const cell = line.insertCell(), piece = document.createElement('span');
                cell.append(piece);
                fourCells.push(piece);
            }
        }
    }
    function drawFour(c) {
        const detail = $('[data-four]'), status = $('[data-four-status]');
        const action = $('[data-four-action]'), board = $('[data-four-board]'), leave = $('[data-four-leave]');
        const availability = $('[data-four-availability]');
        const focused = detail.contains(document.activeElement) ? document.activeElement : null;
        if (fourRoom !== c) {
            fourRoom = c; detail.open = false; fourPlayed = false;
            fourGameId = ''; fourActionPending = false;
        }
        detail.hidden = !c || !fourInARowSupported || shieldActive || (!!gameGuest && gameGuest.game !== 'four');
        if (detail.hidden) {
            fourInvite = null;
            status.textContent = '';
            availability.textContent = '';
            board.hidden = true;
            $('[data-four-invite]').hidden = true;
            return;
        }
        const game = c.four, seat = game?.host === app.selfId ? 'X' : game?.guest === app.selfId ? 'O' : '';
        const openSeat = !!game && !game.guest && !seat;
        if (openSeat && fourGameId !== game.id) detail.open = true;
        if (gameGuest?.game === 'four' && game) detail.open = true;
        fourGameId = game?.id || '';
        const hostWaiting = !!game && !game.guest && game.host === app.selfId && !fourFinished(game);
        fourInvite = hostWaiting && gameGuestInvitesSupported && !gameGuest && amOp(c) ? gameNightInvite('four', game.id) : null;
        $('[data-four-invite]').hidden = !fourInvite;
        const availabilityText = openSeat ? 'Four in a Row has an open seat. Choose Join match to play.' : '';
        if (availability.textContent !== availabilityText) availability.textContent = availabilityText;
        $('[data-four-seats]').hidden = !game;
        if (game) {
            const playerName = (id, mark) => id ? c.names.find(person => person.id === id)?.nick || `Player ${mark}` : 'Open seat';
            $('[data-four-player="X"]').textContent = playerName(game.host, 'X');
            $('[data-four-player="O"]').textContent = playerName(game.guest, 'O');
        }
        const playing = !!game?.guest && !fourFinished(game);
        const yourTurn = playing && seat === fourMark(game.moves);
        let message = fourPlayed ? 'Match ended. A host can open another.' : 'Two players. Connect four pieces in any direction.';
        let button = amOp(c) ? ['open', game ? 'Play again' : 'Open a match'] : null;
        let leaveLabel = '';
        if (game) {
            fourPlayed = true;
            if (!game.guest) {
                message = seat ? 'Waiting for someone in the room to join.' : 'An open seat is available. X goes first.';
                button = seat ? null : ['join', 'Join match'];
                if (seat) leaveLabel = 'Close match';
            } else {
                const lastMove = game.moves ? `${fourMark(game.moves - 1)} played column ${game.lastColumn + 1}. ` : '';
                const turn = yourTurn ? `Your turn (${seat}).` : `${fourMark(game.moves)} to play.`;
                message = lastMove + (game.winner ? `${game.winner} wins.` : playing ? turn : 'Draw.');
                if (playing) {
                    button = null;
                    if (seat) leaveLabel = 'Leave match';
                }
            }
        }
        if (status.textContent !== message) status.textContent = message;
        action.hidden = !button;
        action.setAttribute('aria-disabled', String(fourActionPending));
        if (button) {
            action.dataset.fourAction = button[0]; action.textContent = button[1];
        }
        leave.hidden = !leaveLabel;
        leave.textContent = leaveLabel;
        board.hidden = !game?.guest;
        if (!board.hidden) {
            if (!fourButtons.length) buildFourBoard();
            const last = game.board.findIndex((mark, index) => mark && index % FOUR_COLUMNS === game.lastColumn);
            const winning = new Set(game.winner ? fourWinningCells(game.board, last) : []);
            fourButtons.forEach((b, col) => {
                const full = !!game.board[col], enabled = yourTurn && !full;
                b.setAttribute('aria-label', `Drop in column ${col + 1}${full ? ' (full)' : ''}`);
                b.setAttribute('aria-disabled', String(!enabled));
                b.tabIndex = enabled ? 0 : -1;
            });
            fourCells.forEach((piece, index) => {
                const mark = game.board[index], cell = piece.parentElement;
                if (piece.textContent !== mark) piece.textContent = mark;
                cell.dataset.mark = mark;
                cell.toggleAttribute('data-last', index === last);
                cell.toggleAttribute('data-winning', winning.has(index));
                cell.setAttribute('aria-label', winning.has(index) ? `${mark}, winning piece` : mark || 'Empty');
            });
        }
        if (focused === action && action.hidden) status.focus({ preventScroll: true });
        else if (focused && (focused === leave && leave.hidden || board.contains(focused) && board.hidden))
            detail.querySelector('summary').focus({ preventScroll: true });
    }
    $('[data-four-action]').addEventListener('click', event => fourCommand(event.currentTarget.dataset.fourAction));
    $('[data-four-leave]').addEventListener('click', () => fourCommand('leave'));
    $('[data-four-invite]').addEventListener('click', () => {
        const target = fourInvite;
        if (!target) return;
        openInviteDialog($('[data-four-invite]'), target);
        if ($('[data-invite-dialog]').open) void prepareGuestLink(target, true, true);
    });
    function changeGameLink(value) {
        const c = currentGameNight();
        return !!(c && c === gameEditorRoom && amOp(c) && cmd('discord', [value], c.name, c.keepRef));
    }
    $('[data-game-invite]').addEventListener('click', event => openInviteDialog(event.currentTarget));
    gameShareButton?.addEventListener('click', () => {
        const c = currentGameNight();
        if (!betaShell || !gameShareDialog || !c || !amOp(c)) return;
        const fragment = gameNightFragment?.({ room: c.name, ref: c.keepRef });
        if (!fragment) return;
        const url = new URL('/beta/?' + GAME_NIGHT_QUERY, location.origin);
        if (entrySource === 'stalemate' || entrySource === 'rad-dad') url.searchParams.set('via', entrySource);
        gameShareValue.value = url.href + fragment;
        gameShareDialog.dataset.room = c.keepRef;
        $('[data-game-share-status]').textContent = '';
        gameShareDialog.showModal();
        gameShareValue.select();
    });
    $('[data-game-share-copy]')?.addEventListener('click', async () => {
        const link = gameShareValue.value;
        if (!gameShareDialog.open || !link) return;
        try {
            await navigator.clipboard.writeText(link);
            if (gameShareDialog.open && gameShareValue.value === link) $('[data-game-share-status]').textContent = 'Room address copied.';
        } catch {
            if (gameShareDialog.open && gameShareValue.value === link) {
                gameShareValue.select();
                $('[data-game-share-status]').textContent = 'Select and copy the room address.';
            }
        }
    });
    $('[data-game-share-close]')?.addEventListener('click', () => gameShareDialog.close());
    gameShareDialog?.addEventListener('close', () => {
        if (!gameShareDialog.open) { gameShareValue.value = ''; delete gameShareDialog.dataset.room; }
    });
    $('[data-game-form]').addEventListener('submit', event => {
        event.preventDefault();
        const input = $('[data-game-link]');
        const link = discordCallLink(input.value);
        const error = $('[data-game-error]');
        if (!link) {
            error.textContent = 'Paste a Discord invite or a server channel link.';
            input.focus();
        } else if (changeGameLink(link)) error.textContent = '';
        else error.textContent = 'Reconnect and open Host tools before trying again.';
    });
    $('[data-game-clear]').addEventListener('click', () => {
        $('[data-game-error]').textContent = changeGameLink('clear') ? '' : 'Reconnect before removing the link.';
        $('[data-game-link]').focus();
    });

    function drawChan() {
        drawKeepPrompt();
        refreshPaletteCohosts();
        const key = app.active;
        const c = store(key);
        const isPm = key.startsWith('pm:');
        const pmLabel = c?.nick || (sessionEnded && endedPmLabel?.key === key ? endedPmLabel.nick : 'unconfirmed visitor');
        $('[data-lobby-welcome]').hidden = app.localMediaPaused || key !== '#stalemate';
        $('[data-chat-context]').textContent = isPm ? `PM · ${pmLabel}` : key;
        $('[data-topic]').textContent = isPm ? `Private chat with ${pmLabel}${c?.open ? '' : ' · replies unconfirmed; draft kept'} · not end-to-end encrypted · report shares selected text · tap their name to block` : c ? `${c.topic || ''}` : '';
        const room = !isPm && c && c.kind !== 'lobby';
        if (inviteContext && (inviteContext !== c || connectionState !== 'connected' || !amOp(c))) closeInviteDialog();
        $('[data-roombar]').hidden = app.sharingStopped || app.localMediaPaused || !room;
        drawJam();
        drawGameNight();
        const showAct = !app.sharingStopped && !app.localMediaPaused && room && ['bobross', 'watch', 'art'].includes(c.kind);
        $('[data-activity]').hidden = !showAct;
        $('[data-activity-title]').textContent = showAct ? c.kind === 'art' ? 'A canvas for everyone' : c.kind === 'bobross' ? 'A little paint. A little Bob Ross.' : 'Watching together' : 'Shared activity';
        $('[data-act-stage]').hidden = !showAct;
        document.body.classList.toggle('am-op', !app.localMediaPaused && !!(c && amOp(c)));
        if (room) {
            const m = c.modes;
            const hosts = c.names.filter((n) => n.prefix === '@').map((n) => n.nick);
            $('[data-host-status]').textContent = (c.persistent ? `Registered · expires ${new Date(c.expiresAt).toLocaleDateString()} · ` : 'Temporary · ') + (amOp(c) ? 'You have @ host controls · /op nick adds a co-host' : hosts.length ? `Hosts: ${hosts.map((nick) => `@${nick}`).join(', ')}` : 'No room host online. An existing host can return, or a site moderator can help.');
            $('[data-modes]').textContent = `${KIND_NAME[c.kind]} · +t${m.m ? 'm' : ''}${m.i ? 'i' : ''}${m.k ? 'k' : ''}${m.C ? 'C' : ''}${m.Q ? 'Q' : ''}${m.S ? ` slow ${m.S}s` : ''}${m.locked ? ' 🔒' : ''} · ${c.count}/${m.l}`;
            const cam = $('[data-cam]');
            cam.hidden = app.localMediaPaused || ['chat', 'game'].includes(c.kind);
            cam.setAttribute('aria-pressed', String(!!c.myCam));
            cam.textContent = c.myCam ? '📷 Camera on' : m.C ? '📷 Camera (18+)' : '📷 Cameras off here';
            cam.disabled = !m.C && !c.myCam;
        }
        const peopleHeading = $('[data-people-title]');
        peopleHeading.textContent = isPm ? 'PM' : c ? `${c.name} · ${c.count || c.names?.length || 0}` : 'People';
        peopleHeading.tabIndex = -1;
        const ul = $('[data-nicks]');
        const focusedPerson = ul.contains(document.activeElement) && document.activeElement.matches('button.nick') ? document.activeElement : null;
        const focusedId = focusedPerson?.dataset.connectionId;
        const previous = new Map([...ul.children].filter(li => li.dataset.connectionId).map(li => [li.dataset.connectionId, li]));
        const rows = (c && c.names || []).map((n) => {
            // Reuse only a server connection identity, never a nickname. Keeping
            // the button also preserves a still-present person's dialog opener.
            const id = typeof n.id === 'string' && n.id ? n.id : null;
            const li = id && previous.get(id) || document.createElement('li');
            const b = li.querySelector('button.nick') || document.createElement('button');
            if (id) { li.dataset.connectionId = id; b.dataset.connectionId = id; }
            b.type = 'button'; b.className = 'nick'; b.style.color = colorOf(n.nick);
            b.dataset.self = String(!!app.selfId && n.id === app.selfId);
            b.textContent = `${n.prefix}${n.nick}${n.band ? ' ⭐' : n.moderator ? ' MOD' : ''}${n.cam ? ' 📷' : ''}${n.away ? ' 💤' : ''}`;
            if (isPm) {
                b.disabled = !privateMessagePeersSupported || !pmFrameValid({ peer: c.peer, ref: c.ref }) || id !== c.peer;
                b.onclick = () => nickSheet(c.nick);
            } else {
                const context = personContext(id, c.name, c.keepRef, n.nick);
                b.disabled = !personContextValid(context);
                b.onclick = () => nickSheet(n.nick, context);
            }
            if (!b.parentElement) li.append(b);
            const entryText = entryBadge(n.entrySource, entrySites);
            const entry = li.querySelector('.entry-badge');
            if (entryText) {
                const badge = entry || document.createElement('span');
                badge.className = 'entry-badge'; badge.textContent = entryText;
                if (!badge.parentElement) li.append(badge);
            } else entry?.remove();
            return li;
        });
        ul.replaceChildren(...rows);
        if (focusedPerson) {
            const target = (focusedId && rows.find(li => li.dataset.connectionId === focusedId)?.querySelector('button.nick')) || peopleHeading;
            if (document.activeElement !== target) {
                if (target === peopleHeading) target.focus();
                else target.focus({ preventScroll: true });
            }
        }
    }

    function drawRooms() {
        const ul = $('[data-roomlist]');
        const focusedRoom = ul.contains(document.activeElement) && document.activeElement.matches('button.room') ? document.activeElement : null;
        const focusedName = focusedRoom?.dataset.room;
        const previous = new Map([...ul.children].filter(li => li.dataset.roomKey).map(li => [li.dataset.roomKey, li]));
        const query = $('[data-room-search]').value.trim().toLowerCase();
        const filter = $('[data-room-filter]').value;
        const rooms = Discovery.describeRooms(app.rooms.filter((r) =>
            (filter === 'mine' ? r.mine : filter === 'registered' ? r.persistent : r.count > 0 || !r.persistent)
            && (!query || `${r.name} ${r.title}`.toLowerCase().includes(query))), [...app.chans.keys()]);
        $('[data-room-count]').textContent = String(rooms.length);
        $('[data-rooms-empty]').hidden = rooms.length > 0;
        const rows = rooms.map(r => {
            const li = previous.get(r.name) || document.createElement('li');
            li.dataset.roomKey = r.name;
            const b = li.querySelector('button.room') || document.createElement('button');
            b.type = 'button'; b.className = 'room';
            b.dataset.room = r.name;
            b.dataset.state = r.state;
            b.disabled = app.localMediaPaused || !r.canJoin || connectionState !== 'connected';
            const t = document.createElement('b'); t.textContent = `${KIND_ICON[r.kind]} ${r.title}`;
            const s = document.createElement('span'); s.textContent = `${r.name} · ${r.count}/${r.max} here · ${r.persistent ? 'Registered' : 'Temporary'} · ${r.hostPresent ? 'Host here' : 'Host away'}`;
            const action = document.createElement('span'); action.className = 'room-action'; action.textContent = `${r.statusLabel} · ${r.actionLabel}`;
            b.replaceChildren(t, s, action);
            b.onclick = () => {
                if (app.chans.has(r.name)) return switchTo(r.name);
                if (r.key) { const k = prompt(`${r.name} has a key. Type it:`) || ''; return cmd('join', [r.name, k]); }
                return cmd('join', [r.name]);
            };
            if (!b.parentElement) li.append(b);
            return li;
        });
        ul.replaceChildren(...rows);
        if (focusedRoom) {
            const current = rows.find(li => li.dataset.roomKey === focusedName)?.querySelector('button.room');
            const target = current && !current.disabled ? current : $('[data-room-filter]');
            if (target?.isConnected && target.getClientRects().length && document.activeElement !== target) {
                target.focus({ preventScroll: target === current });
            }
        }
    }

    $('[data-room-filter]').addEventListener('change', drawRooms);
    $('[data-room-search]').addEventListener('input', drawRooms);
    $('[data-owner-signin]').href = relayBase ? `${relayBase.replace(/^ws/, 'http')}/lobby-owner/login?entry-return=1` : '#';
    $('[data-owner-signin]').addEventListener('click', event => { if (!prepareOwnerSignin()) event.preventDefault(); });
    $('[data-keep-cancel]').addEventListener('click', () => clearKeep('Room not kept. You can keep it later from Host tools.'));
    $('[data-keep-accept]').addEventListener('click', () => {
        drawKeepPrompt();
        if (!pendingKeep || pendingKeep.stage !== 'confirm' || app.active !== pendingKeep.room) return;
        pendingKeep.stage = 'submitted'; drawKeepPrompt();
        if (pendingKeep && !cmd('register', [], pendingKeep.room, pendingKeep.ref)) clearKeep('The Keep request was not confirmed. Check Host tools before trying again.');
    });
    $('[data-gate-guest]').hidden = !ownerSession;
    $('[data-gate-guest]').addEventListener('click', () => { clearMessageRecovery(); ownerSession = false; removeTab('hangout-owner'); $('[data-gate-guest]').hidden = true; connect(app.me || nickInput.value); });
    $('[data-owner-signout]').addEventListener('click', () => {
        clearMessageRecovery(); ownerSession = false; removeTab('hangout-owner'); connect(app.me || nickInput.value);
    });
    let gatheringReminder = null;
    function resolvedTimeZone() {
        try {
            const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            if (typeof zone === 'string' && zone) return zone;
        } catch { /* A missing time zone is shown in UTC by describeVisit. */ }
        return '';
    }
    function drawCommunity() {
        const lobby = app.chans.get('#stalemate');
        const connected = connectionState === 'connected';
        // confirmedGathering and approvedCreation stay null until a later slice
        // supplies a real record. This visit does not invent either one.
        const visit = Discovery.describeVisit({
            connection: connectionState, channel: lobby, me: app.me,
            gathering: app.confirmedGathering, creation: app.approvedCreation,
            now: Date.now(), timeZone: resolvedTimeZone()
        });
        const view = Discovery.visitView(visit);
        $('[data-owner-signin]').hidden = sessionEnded;
        $('[data-lobby-count]').textContent = view.lobbyCount;
        $('[data-presence-title]').textContent = view.presenceTitle;
        $('[data-presence-detail]').textContent = view.presenceDetail;
        $('[data-welcome-title]').textContent = view.welcomeTitle;
        const gathering = $('[data-gathering]');
        gathering.hidden = !view.showGathering;
        $('[data-gathering-heading]').textContent = view.gatheringHeading;
        $('[data-gathering-host]').textContent = view.gatheringHost;
        $('[data-gathering-when]').textContent = view.gatheringWhen;
        $('[data-gathering-activity]').textContent = view.gatheringActivity;
        $('[data-gathering-note]').textContent = view.gatheringNote;
        $('[data-gathering-save]').hidden = !view.showSave;
        gatheringReminder = view.showSave ? visit.gathering : null;
        const creation = $('[data-creation]');
        creation.hidden = !view.showCreation;
        $('[data-creation-heading]').textContent = view.creationHeading;
        $('[data-creation-title]').textContent = view.creationTitle;
        $('[data-creation-detail]').textContent = view.creationDetail || view.creationMissing;
        const prompt = $('[data-quiet-prompt]');
        prompt.hidden = !view.showQuietPrompt;
        prompt.textContent = view.showQuietPrompt ? view.quietPromptLabel : 'Offer a one-line idea';
        if (view.showQuietPrompt) prompt.dataset.prompt = view.quietPromptDraft;
        else delete prompt.dataset.prompt;
        const paused = !app.band && (app.netLock === 'readonly' || app.budget === 'readonly');
        const note = $('[data-network-note]');
        note.hidden = !paused && connected;
        note.textContent = sessionEnded ? 'This session is closed. Your unsent message is available to copy.'
            : !connected ? 'You’re offline. Your draft stays here until you reconnect.' : 'Chat is read-only for now. Your unsent draft stays here.';
    }
    $('[data-gathering-save]').addEventListener('click', () => {
        if (!gatheringReminder) return;
        const ics = Discovery.calendarReminder(gatheringReminder, Date.now());
        if (!ics) return toast('This reminder could not be saved.');
        const blob = new Blob([ics], { type: 'text/calendar' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'hangout-gathering.ics';
        link.rel = 'noopener';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    });
    $('[data-lobby-home]').addEventListener('click', () => { if (app.chans.has('#stalemate')) switchTo('#stalemate'); });
    $('[data-reconnect]').addEventListener('click', () => connect(app.me || nickInput.value.trim()));
    $('.conversation-starters').addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button || !$('.conversation-starters').contains(button)) return;
        const draft = button.dataset.prompt;
        if (!draft) return;
        const input = $('[data-text]');
        if (input.value.trim()) return toast('You already have a draft. Send it or clear it first.');
        input.value = draft; input.focus();
    });

    // Activity tiles pick a name; plain chat lets guests name their own channel.
    $$('[data-start]').forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.start === 'chat') {
            $('[data-channel-error]').textContent = '';
            $('[data-channel-dialog]').showModal();
            $('[data-channel-name]').focus();
            return;
        }
        const kind = b.dataset.start;
        if (kind === 'game') {
            if (gameNightSupported) openGameRoom();
            return;
        }
        count(`room-start-${kind}`); cmd('join', [`#${kind}-${slug()}`]);
    }));
    $('[data-channel-cancel]').addEventListener('click', () => $('[data-channel-dialog]').close());
    $('[data-channel-dialog]').addEventListener('close', () => {
        // A queued close event may belong to an earlier opening. Preserve the
        // current request if the visitor has already opened the dialog again.
        if (!$('[data-channel-dialog]').open) app.pendingChannel = '';
    });
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
        if ((/^#(?:art|watch|bobross|jam)(?:-|$)/.test(name) || gameNightSupported && gameNightRoomName(name)) && !app.rooms.some((r) => r.name === name)) {
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

    let legacyPmSequence = 0;
    const pmFrameValid = m => typeof m?.peer === 'string' && m.peer.length > 0 && m.peer.length <= 160
        && typeof m.ref === 'string' && /^[a-f0-9]{32}$/.test(m.ref);
    function pmFrameView(m) {
        if (!pmFrameValid(m)) return null;
        const view = app.pms.get(m.ref);
        return view?.peer === m.peer ? view : null;
    }
    function updatePmName(view, nick) {
        if (typeof nick !== 'string' || !nick || nick.length > 20) return;
        view.nick = nick;
        view.names = [{ id: view.peer, nick, prefix: '' }, { nick: app.me, prefix: '' }];
    }
    function openPm(m, focus, allowCreate = true) {
        if (typeof m.with !== 'string' || !m.with || m.with.length > 20) return null;
        if (privateMessagePeersSupported && !pmFrameValid(m)) return null;
        const bound = privateMessagePeersSupported && pmFrameValid(m);
        let view = bound ? pmFrameView(m) : !allowCreate ? [...app.pms.values()].filter(p => p.legacy && p.nick === m.with).at(-1) : null;
        if (bound && app.pms.has(m.ref) && (!view || !view.open)) return null;
        if (!view) {
            if (!allowCreate && bound) return null;
            const ref = bound ? m.ref : `unconfirmed-${++legacyPmSequence}`;
            view = { ref, peer: bound ? m.peer : null, open: bound, legacy: !bound, lines: [], unread: 0 };
            updatePmName(view, m.with); app.pms.set(ref, view);
        } else updatePmName(view, m.with);
        drawTabs();
        if (focus) switchTo(`pm:${view.ref}`);
        return view;
    }
    function pmDraftNotice(view) {
        const key = app.active, input = $('[data-text]');
        toast('Private replies are not confirmed. Your draft stays here.', [
            ['Copy draft', async () => {
                const lifecycle = recoveryLifecycle;
                if (app.active !== key || store(key) !== view) return;
                const current = () => lifecycle === recoveryLifecycle && app.active === key && store(key) === view;
                try { await navigator.clipboard.writeText(input.value); if (current()) toast('Draft copied. Nothing was sent.'); }
                catch { if (current()) { input.focus(); input.select(); toast('Select and copy this draft. Nothing was sent.'); } }
            }],
            ['Discard draft', () => { if (app.active === key && store(key) === view) { input.value = ''; drafts.delete(key); recoveryDraftChanged(); } }]
        ]);
    }
    function pmRequest(m) {
        if (typeof m.from !== 'string' || !m.from || m.from.length > 20) return;
        clearPmRequest(m);
        const box = $('[data-pmreqs]'), bound = privateMessagePeersSupported && pmFrameValid(m);
        const div = document.createElement('div');
        div.className = 'req'; div.dataset.pmFrom = m.from;
        if (bound) div.dataset.pmRef = m.ref;
        const p = document.createElement('span'); p.textContent = `✉ ${m.from}${m.band ? ' ⭐' : ''} wants to chat`;
        div.append(p);
        for (const [label, name] of [['Accept', 'accept'], ['No thanks', 'decline'], ['Block', 'block']]) {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn--small'; b.textContent = label;
            b.addEventListener('click', () => {
                if (!bound) return toast('This server cannot confirm the request’s original peer. Use an explicit /accept nickname or /decline nickname, or choose a current person.');
                if (name === 'block' && !personTargetsSupported) return toast('Identity-safe blocking is unavailable on this server. You can deliberately type /block nickname, report an exact message, or leave.');
                if (send({ t: 'cmd', name, args: [m.from], ch: app.active, pmPeer: m.peer, pmRef: m.ref })) div.remove();
                else toast('You are offline. Reconnect before answering a PM request.');
            });
            div.append(b);
        }
        box.append(div);
    }
    function clearPmRequest(m) {
        $$('[data-pm-from]', $('[data-pmreqs]')).forEach(request => {
            if (pmFrameValid(m) ? request.dataset.pmRef === m.ref : !request.dataset.pmRef && request.dataset.pmFrom === m.from) request.remove();
        });
    }

    let personSheetReturn = null;
    function nickSheet(nick, context) {
        const c = store(app.active);
        const pmContext = context?.t === 'pm';
        const pmView = pmContext ? pmFrameView(context) : !context && app.active.startsWith('pm:') && c?.nick === nick ? c : null;
        if (pmContext && !pmView) return toast('That private peer is no longer confirmed. Choose a current person for a new request.');
        const selected = pmView ? { peer: pmView.peer } : context;
        if (!pmView && !personContextValid(selected)) return toast('Person actions are unavailable here. Use a deliberately typed nickname command or report an exact message.');
        nick = pmView?.nick || personLabel(selected);
        if (!nick) return;
        const peerCommand = (name, args = []) => {
            if (!pmView) return personCommand(selected, name, args);
            if (!privateMessagePeersSupported || !pmView.peer || !pmView.ref || !pmView.open && !['block', 'ignore', 'unignore', 'whois'].includes(name)) { pmDraftNotice(pmView); return false; }
            if (name === 'block' && !personTargetsSupported) { personSheetStatus('Identity-safe blocking is unavailable on this server. You can deliberately type /block nickname, report an exact message, or leave.'); return false; }
            const sent = send({ t: 'cmd', name, args, ch: `pm:${pmView.ref}`, pmPeer: pmView.peer, pmRef: pmView.ref });
            if (!sent) personSheetStatus('The action was not sent. Reconnect before trying again.');
            return sent;
        };
        const sheet = $('[data-sheet]');
        const opener = document.activeElement;
        personSheetReturn = $('[data-nicks]').contains(opener) && opener.matches('button.nick') ? { opener, channel: app.active } : null;
        personSheetSelection = selected;
        $('[data-sheet-title]').textContent = nick;
        sheet.querySelector('[data-person-status]')?.remove();
        const box = $('[data-sheet-buttons]'); box.replaceChildren();
        const act = (label, fn, cls = '', keepOpen = false) => {
            const b = document.createElement('button'); b.type = 'button'; b.className = `btn ${cls}`; b.textContent = label;
            b.addEventListener('click', () => { if (fn() !== false && !keepOpen) sheet.close(); }); box.append(b); return b;
        };
        const ignore = act(app.peerIgnores.has(selected.peer) ? 'Unignore' : 'Ignore', () => {
            const name = app.peerIgnores.has(selected.peer) ? 'unignore' : 'ignore';
            if (!peerCommand(name, [pmView?.nick || personLabel(selected)])) return false;
            personPreferencePending = { peer: selected.peer, name };
            personSheetStatus('Sent. Waiting for the server to confirm your preference.'); return true;
        }, '', true);
        ignore.dataset.personIgnore = '';
        if (!personTargetsSupported) { ignore.disabled = true; ignore.title = 'Confirmed identity preferences are unavailable on this server.'; }
        const named = nick.toLowerCase();
        if (app.ignores.has(named)) act(`Remove named ignore: ${nick}`, () => {
            if (!namedCmd('unignore', [named])) return false;
            personPreferencePending = { name: 'unignore', named };
            personSheetStatus('Sent. Waiting for the server to confirm removal of the named rule.'); return true;
        }, 'btn--ghost', true);
        if (app.localMediaPaused || app.sharingStopped) {
            act('Block', () => peerCommand('block', [nick]), 'btn--ghost'); sheet.showModal(); return;
        }
        act('✉ PM', () => peerCommand('query', [nick]));
        act('🐟 Slap', () => peerCommand('slap', [nick]));
        act('Who?', () => peerCommand('whois', [nick]));
        act('Block', () => peerCommand('block', [nick]), 'btn--ghost');
        act('🚩 Report', () => {
            const message = !pmView && context?.message;
            if (!message?.id || typeof message.text !== 'string') { personSheetStatus('Use the report flag beside the exact message you want to share.'); return false; }
            const flag = $$('[data-buffer] li').find(row => row.dataset.id === message.id)?.querySelector('.flag');
            if (flag && !flag.disabled) { flag.click(); return true; }
            personSheetStatus('Use the report flag beside that exact message. Its confirmation may already be pending.'); return false;
        }, 'btn--ghost');
        const origin = !pmView && app.chans.get(selected.channel);
        if (origin && amOp(origin)) {
            act('Kick', () => peerCommand('kick', [nick, 'take a breather']), 'btn--danger');
            act('Ban', () => { const why = prompt(`Ban ${personLabel(selected)}. Reason?`); return why?.trim() ? peerCommand('ban', [nick, ...why.trim().split(' ')]) : false; }, 'btn--danger');
            if (origin.kind !== 'lobby') { act('Make @', () => peerCommand('op', [nick])); act('Give voice', () => peerCommand('voice', [nick])); act('Invite here', () => peerCommand('invite', [nick, origin.name])); }
            if (app.band) act('Mute 10m', () => peerCommand('mute', [nick, '10m']), 'btn--danger');
        }
        sheet.showModal();
    }
    $('[data-sheet-close]').addEventListener('click', () => $('[data-sheet]').close());
    $('[data-sheet]').addEventListener('close', event => {
        // A queued close event must not consume a newer open sheet's return.
        const sheet = event.currentTarget;
        if (sheet.open) return;
        const destination = personSheetReturn;
        personSheetReturn = null;
        // Recover only body focus or a control in this now-closed sheet.
        // An intentionally focused control elsewhere keeps its focus.
        const focused = document.activeElement;
        if (!destination || destination.opener.isConnected || app.active !== destination.channel
            || focused !== document.body && !sheet.contains(focused) || $('dialog[open]')) return;
        const heading = $('[data-people-title]');
        if (heading?.isConnected && heading.getClientRects().length) heading.focus();
    });

    // Command palette: every slash command as a button.
    const PALETTE = [
        ['/me', 'me', 'does what? (e.g. moshes)'], ['/nick', 'nick', 'new nick'], ['/away', 'away', 'reason (blank = back)'], ['/list', 'list'], ['/names', 'names'],
        ['/topic', 'topic'], ['/whois', 'whois', 'nick'], ['/msg', 'msg', 'nick then message'], ['/ignore', 'ignore', 'nick'], ['/join', 'join', '#room'],
        ['/slap', 'slap', 'nick'], ['/help', 'help'], ['/quit', 'quit']
    ];
    const OP_PALETTE = [['Invite guest', 'invite-guest'], ['/mode +m', 'mode', null, ['+m']], ['/mode -m', 'mode', null, ['-m']], ['/mode +i', 'mode', null, ['+i']], ['/mode -i', 'mode', null, ['-i']], ['Slow 10s', 'mode', null, ['+S', '10']], ['Slow off', 'mode', null, ['-S']],
        ['Cams off', 'mode', null, ['-C']], ['Cams allowed', 'mode', null, ['+C']], ['/topic …', 'topic', 'new topic'], ['🔒 Lock', 'lock'], ['🔓 Unlock', 'lock', null, ['off']], ['Add guest co-host', 'op', 'nickname'], ['Remove guest co-host', 'deop', 'nickname'], ['Keep this room', 'register'], ['Add verified co-host', 'cohost', 'add nickname'], ['Remove verified co-host', 'cohost', 'remove nickname'], ['Transfer ownership', 'transfer', 'verified co-host nickname'], ['Delete registration', 'unregister'], ['Close room', 'close']];
    function paletteArgs(name, value) {
        const text = value.trim();
        if (!text) return [];
        // Text bodies occupy one bounded argument; word count is not an argument count.
        if (['me', 'away', 'topic'].includes(name)) return [text];
        if (name === 'msg') {
            const separator = text.search(/\s/);
            return separator < 0 ? [text] : [text.slice(0, separator), text.slice(separator).trimStart()];
        }
        return text.split(' ');
    }
    function paletteCohosts(origin) {
        const current = origin && app.chans.get(origin.channel);
        return origin?.ops && paletteContext === origin && $('[data-palette]').open && connectionState === 'connected'
            && personTargetsSupported && app.active === origin.channel && roomNonce(origin.instance) && current?.keepRef === origin.instance
            && current.names?.some(n => n.nick === app.me && n.owner) && Array.isArray(current.cohosts) ? current.cohosts : [];
    }
    function refreshPaletteCohosts() {
        const box = $('[data-palette-buttons]'), origin = paletteContext;
        const existing = new Map($$('[data-cohost-account]', box).map(button => [button.dataset.cohostAccount, button]));
        const focused = document.activeElement;
        for (const host of paletteCohosts(origin)) {
            let button = existing.get(host.id);
            if (!button) {
                button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn--small';
                button.dataset.cohostAccount = host.id;
                button.addEventListener('click', () => {
                    const currentHost = paletteCohosts(origin).find(current => current.id === host.id);
                    if (!button.isConnected || !currentHost) return toast('That room or co-host changed. Choose current Host tools before trying again.');
                    if (!confirm(`Remove ${currentHost.label} as a verified co-host?`)) return;
                    if (!paletteCohosts(origin).some(current => current.id === host.id)) return toast('That room or co-host changed. Choose current Host tools before trying again.');
                    if (send({ t: 'cmd', name: 'cohost', args: ['remove', host.id], ch: origin.channel, roomInstance: origin.instance, cohostAccount: true })) $('[data-palette]').close();
                    else toast('Co-host removal was not sent. Reconnect before trying again.');
                });
                box.append(button);
            }
            button.textContent = `Remove verified co-host: ${host.label}`;
            existing.delete(host.id);
        }
        for (const button of existing.values()) button.remove();
        // Keep every surviving command's DOM identity and focus. If a focused
        // co-host action was retired, return focus inside the still-open dialog.
        if (existing.size && [...existing.values()].includes(focused) && $('[data-palette]').open)
            (box.querySelector('button') || $('[data-palette-close]')).focus();
    }
    function openPalette(ops) {
        const box = $('[data-palette-buttons]');
        const current = store(app.active);
        const origin = paletteContext = { channel: app.active, instance: current?.keepRef, ops };
        const owner = current?.names?.find((n) => n.nick === app.me)?.owner;
        box.replaceChildren();
        for (const [label, name, ask, fixed] of (ops ? OP_PALETTE : PALETTE)) {
            if (name === 'register' && current?.persistent) continue;
            if (['cohost', 'transfer', 'unregister'].includes(name) && !owner) continue;
            if (current?.persistent && ['op', 'deop', 'close'].includes(name) && !owner && !app.capabilities?.configure) continue;
            if (['chat', 'game'].includes(current?.kind) && name === 'mode' && ['+C', '-C'].includes(fixed?.[0])) continue;
            if (current?.kind === 'game' && name === 'mode' && ['+i', '-i'].includes(fixed?.[0])) continue;
            const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn--small'; b.textContent = label;
            b.addEventListener('click', () => {
                $('[data-palette]').close();
                if (ops && (!roomNonce(origin.instance) || app.chans.get(origin.channel)?.keepRef !== origin.instance)) return toast('That room changed. Choose current Host tools before trying again.');
                const channel = ops ? origin.channel : app.active, instance = ops ? origin.instance : undefined;
                if (name === 'invite-guest') return openInviteDialog();
                if (['deop', 'unregister', 'transfer', 'close'].includes(name) && !confirm(current?.persistent && ['close', 'unregister'].includes(name) ? `Permanently delete ${app.active} and release its registered name?` : `${label} in ${app.active}?`)) return;
                if (name === 'register' && !app.verified) { if (prepareOwnerSignin(current)) location.assign($('[data-owner-signin]').href); return; }
                if (name === 'register' && current?.keepRef) return cmd(name, [], origin.channel, origin.instance);
                if (name === 'cohost') { const who = prompt(`${label}: nickname`); if (!who) return; if (label.startsWith('Remove') && !confirm(`Remove ${who} as co-host?`)) return; return namedCmd(name, [label.startsWith('Remove') ? 'remove' : 'add', who.trim()], channel, instance); }
                if (fixed) return cmd(name, fixed, channel, instance);
                if (ask) { const v = prompt(`${label}: ${ask}`); if (v === null) return undefined; return namedCmd(name, paletteArgs(name, v), channel, instance); }
                return cmd(name, [], channel, instance);
            });
            box.append(b);
        }
        $('[data-palette]').showModal();
        refreshPaletteCohosts();
    }
    $('[data-palette-open]').addEventListener('click', () => openPalette(false));
    $('[data-roomtools]').addEventListener('click', () => openPalette(true));
    $('[data-palette-close]').addEventListener('click', () => $('[data-palette]').close());
    $('[data-palette]').addEventListener('close', () => { if (!$('[data-palette]').open) paletteContext = null; });

    let inviteInstance = '', invitePeople = new Map(), jamInviteOpener = null;
    function closeInviteDialog() {
        inviteInstance = ''; invitePeople.clear();
        inviteContext = null; $('[data-invite-nick]').value = ''; $('[data-invite-options]').replaceChildren();
        $('[data-game-invite-people]').replaceChildren();
        resetGuestLink();
        if ($('[data-invite-dialog]').open) $('[data-invite-dialog]').close();
    }
    function openInviteDialog(opener = null, exactTable = null) {
        const current = store(app.active);
        if (connectionState !== 'connected' || !current || current.kind === 'lobby' || !amOp(current)) return;
        jamInviteOpener = opener ? { button: opener, room: current } : null;
        inviteContext = current; inviteInstance = current.keepRef; invitePeople.clear(); $('[data-invite-room]').textContent = current.name; $('[data-invite-error]').textContent = '';
        $('[data-invite-nick]').value = ''; $('[data-invite-options]').replaceChildren();
        const isGame = current.kind === 'game';
        const roster = $('[data-game-invite-people]');
        roster.replaceChildren();
        $('[data-invite-explainer]').hidden = isGame;
        $('[data-invite-form]').hidden = isGame;
        $('[data-game-invite-picker]').hidden = !isGame;
        const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose a current person'; $('[data-invite-options]').append(placeholder);
        for (const person of app.chans.get('#stalemate')?.names || []) {
            if (!personId(person.id) || person.id === app.selfId || current.names.some(member => member.id === person.id)) continue;
            const context = personContext(person.id, current.name, inviteInstance, person.nick);
            invitePeople.set(person.id, context);
            if (isGame) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'btn btn--ghost';
                button.textContent = `Invite ${person.nick}`;
                button.disabled = !personTargetsSupported || !roomNonce(inviteInstance);
                button.addEventListener('click', () => inviteCurrentPerson(context));
                roster.append(button);
            } else {
                const option = document.createElement('option'); option.value = person.id; option.textContent = person.nick; $('[data-invite-options]').append(option);
            }
        }
        const canInviteNew = isGame && gameGuestInvitesSupported;
        const target = canInviteNew && (exactTable || arcadeInviteTarget());
        const inviteHint = $('[data-game-invite-empty]');
        inviteHint.hidden = !!target || (!canInviteNew && !!roster.childElementCount);
        inviteHint.textContent = canInviteNew ? 'Open a game with a free seat to invite a friend.' : 'Nobody else is in Hang Out yet.';
        const chooseGame = $('[data-game-invite-choose]');
        chooseGame.hidden = !canInviteNew || !!target || $('[data-arcade-game]').hidden;
        $('[data-game-invite-link]').hidden = !target;
        if (target) createGuestLink.textContent = `Invite a friend to ${gameLabel(target.game)}`;
        $('[data-invite-person-send]').disabled = !personTargetsSupported || !roomNonce(inviteInstance);
        $('[data-invite-dialog]').showModal();
        if (isGame) {
            const connectedGuest = roster.querySelector('button:enabled');
            const action = target ? createGuestLink : connectedGuest || (!chooseGame.hidden ? chooseGame : $('[data-game-invite-cancel]'));
            action.focus();
        }
        else $('[data-invite-nick]').focus();
    }
    function roomInviteArgs(nick, room) {
        const target = room.kind === 'game' && arcadeInviteTarget();
        return target ? [nick, room.name, target.game, target.match] : [nick, room.name];
    }
    function arcadeInviteTarget() {
        const detail = $('[data-four]');
        if (fourInvite && detail?.open) return fourInvite;
        return [...arcadeTables.values()].find(table => table.invite && table.controller?.isOpen())?.invite || fourInvite;
    }
    const createGuestLink = $('[data-game-invite-new]'), shareGuestLink = $('[data-game-invite-share]');
    const copyGuestLink = $('[data-game-invite-copy]'), guestLinkStatus = $('[data-game-invite-link-status]');
    let pendingGuestLink = null;
    function resetGuestLink() {
        pendingGuestLink = null;
        createGuestLink.hidden = false; createGuestLink.disabled = false;
        copyGuestLink.hidden = true; shareGuestLink.hidden = true; guestLinkStatus.textContent = '';
    }
    function readyGuestLink() {
        const request = pendingGuestLink, target = arcadeInviteTarget();
        if (request?.link && request.room === currentGameNight() &&
            request.target.game === target?.game && request.target.match === target.match) return request;
        resetGuestLink();
        guestLinkStatus.textContent = 'The table changed. Prepare a new invitation.';
    }
    createGuestLink.addEventListener('click', () => void prepareGuestLink(arcadeInviteTarget()));
    async function deliverPreparedLink(request) {
        const title = `Join me for ${gameLabel(request.target.game)}`;
        if (typeof navigator.share === 'function') {
            try {
                await navigator.share({ title, url: request.link });
                if (pendingGuestLink === request) closeInviteDialog();
                return true;
            } catch (error) {
                if (pendingGuestLink !== request || error.name === 'AbortError') return true;
                return false;
            }
        }
        if (typeof navigator.clipboard?.writeText === 'function') {
            try {
                await navigator.clipboard.writeText(request.link);
                if (pendingGuestLink === request) guestLinkStatus.textContent = 'Invitation copied. Send it to your friend in a message.';
                return true;
            } catch {
                return false;
            }
        }
        return false;
    }
    async function prepareGuestLink(target, preferEmail = false, deliver = false) {
        const room = inviteContext;
        if (!target || !room || room !== currentGameNight() || room.keepRef !== inviteInstance || !amOp(room)) {
            guestLinkStatus.textContent = 'Open a game table with a free seat first.';
            return;
        }
        const request = { room, target, preferEmail };
        pendingGuestLink = request;
        createGuestLink.disabled = true;
        guestLinkStatus.textContent = 'Preparing an invitation…';
        try {
            const response = await fetch('/beta/game-night/invitation/issue', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
                body: JSON.stringify({ actor: app.selfId, room: room.name, ref: room.keepRef, ...target })
            });
            const value = await response.json();
            if (pendingGuestLink !== request || room !== currentGameNight()) return;
            if (!response.ok || !gameInviteCode(value.code)) throw new Error(value.error || 'The invitation could not be prepared. Try again.');
            request.link = new URL('/beta/game-night/guest#invite=' + value.code, location.origin).href;
            createGuestLink.hidden = true;
            const canShare = typeof navigator.share === 'function';
            copyGuestLink.hidden = typeof navigator.clipboard?.writeText !== 'function';
            shareGuestLink.hidden = false;
            shareGuestLink.textContent = canShare ? 'Share invite' : 'Email invite';
            const sharePrimary = canShare || preferEmail || copyGuestLink.hidden;
            copyGuestLink.classList.toggle('btn--ghost', sharePrimary);
            shareGuestLink.classList.toggle('btn--ghost', !sharePrimary);
            guestLinkStatus.textContent = 'One guest can use this invitation within 20 minutes.';
            if (deliver && await deliverPreparedLink(request)) return;
            if (pendingGuestLink !== request) return;
            (sharePrimary ? shareGuestLink : copyGuestLink).focus();
        } catch (error) {
            if (pendingGuestLink !== request) return;
            guestLinkStatus.textContent = error.name === 'TimeoutError' ? 'The invitation took too long. Try again.' : error.message;
        } finally {
            if (pendingGuestLink === request) createGuestLink.disabled = false;
        }
    }
    copyGuestLink.addEventListener('click', async () => {
        const request = readyGuestLink();
        if (!request) return;
        try {
            await navigator.clipboard.writeText(request.link);
            if (pendingGuestLink === request) guestLinkStatus.textContent = 'Invitation copied. Send it to your friend in a message.';
        } catch {
            if (pendingGuestLink !== request) return;
            const fallback = shareGuestLink.textContent;
            guestLinkStatus.textContent = `Couldn’t copy the invitation. You can still use ${fallback}.`;
        }
    });
    shareGuestLink.addEventListener('click', async () => {
        const request = readyGuestLink();
        if (!request) return;
        const title = `Join me for ${gameLabel(request.target.game)}`;
        if (shareGuestLink.textContent === 'Email invite') {
            location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(request.link)}`;
            guestLinkStatus.textContent = 'Choose a friend in the email draft.';
            return;
        }
        try {
            await navigator.share({ title, url: request.link });
            if (pendingGuestLink === request) closeInviteDialog();
        } catch (error) {
            if (pendingGuestLink !== request || error.name === 'AbortError') return;
            shareGuestLink.textContent = 'Email invite';
            shareGuestLink.classList.toggle('btn--ghost', !request.preferEmail && !copyGuestLink.hidden);
            copyGuestLink.classList.toggle('btn--ghost', request.preferEmail);
            guestLinkStatus.textContent = copyGuestLink.hidden
                ? 'Sharing didn’t open. You can send the invitation by email.'
                : 'Sharing didn’t open. Copy or email the invitation.';
        }
    });
    $('[data-jam-invite-room]').addEventListener('click', event => openInviteDialog(event.currentTarget));
    $('[data-invite-cancel]').addEventListener('click', closeInviteDialog);
    $('[data-game-invite-cancel]').addEventListener('click', closeInviteDialog);
    $('[data-game-invite-choose]').addEventListener('click', () => {
        const picker = $('[data-arcade-game]'), room = currentGameNight();
        if (!room || room !== inviteContext || !amOp(room) || picker.hidden) return;
        jamInviteOpener = { button: picker, room };
        closeInviteDialog();
        picker.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    });
    $('[data-invite-dialog]').addEventListener('close', () => {
        if ($('[data-invite-dialog]').open) return;
        const opener = jamInviteOpener;
        jamInviteOpener = null;
        closeInviteDialog();
        if (connectionState !== 'connected') return;
        const current = store(app.active);
        const host = amOp(current);
        const target = host && opener && opener.room === current && !opener.button.hidden
            ? opener.button : $(host ? '[data-roomtools]' : '[data-text]');
        target.focus({ preventScroll: true });
    });
    function inviteCurrentPerson(context) {
        const current = store(app.active);
        if (!inviteContext || inviteContext !== current || current.keepRef !== inviteInstance || !amOp(current) || !context) {
            $('[data-invite-error]').textContent = 'Choose a current person in the original room.'; return;
        }
        // Invitation target may be outside this room, but must remain the
        // original live connection in the shared lobby's current roster.
        const person = findPerson(context.peer);
        if (!person || !personContextValid(context) || current.names.some(member => member.id === context.peer)) {
            $('[data-invite-error]').textContent = 'That person is no longer available to invite.'; return;
        }
        if (send({ t: 'cmd', name: 'invite', args: roomInviteArgs(person.nick, current), ch: context.channel, roomInstance: context.instance, personContext: 1, personPeer: context.peer })) closeInviteDialog();
        else $('[data-invite-error]').textContent = 'The invitation was not sent. Reconnect before trying again.';
    }
    $('[data-invite-person-send]').addEventListener('click', () => inviteCurrentPerson(invitePeople.get($('[data-invite-options]').value)));
    $('[data-invite-form]').addEventListener('submit', event => {
        event.preventDefault();
        const current = store(app.active), nick = $('[data-invite-nick]').value.trim();
        if (!inviteContext || inviteContext !== current || current.keepRef !== inviteInstance || connectionState !== 'connected' || !amOp(current)) return closeInviteDialog();
        if (!/^[A-Za-z][A-Za-z0-9_\-[\]{}^`|]{2,19}$/.test(nick)) {
            $('[data-invite-error]').textContent = 'Use their current nickname: 3–20 letters, numbers or IRC nickname symbols.';
            $('[data-invite-nick]').focus(); return;
        }
        // This is only an affordance. The server checks the current host,
        // recipient and room before granting an invitation.
        const args = roomInviteArgs(nick, current);
        if (namedCmd('invite', args.length === 2 ? [nick] : args, current.name, inviteInstance)) closeInviteDialog();
        else $('[data-invite-error]').textContent = 'Reconnect before sending an invitation.';
    });

    // At deep zoom the workspace can scroll vertically. Native focus may expose
    // the input while leaving its enclosing border or Send partly below the
    // viewport (notably WebKit). Reveal the complete composer without moving
    // focus, changing a draft, or disturbing an already-visible normal layout.
    const composer = $('[data-say]');
    let composerFocusFrame = 0;
    composer.addEventListener('focusin', () => {
        if (innerWidth > 900 || innerHeight > 450) return;
        cancelAnimationFrame(composerFocusFrame);
        composerFocusFrame = requestAnimationFrame(() => {
            composerFocusFrame = 0;
            if (innerWidth > 900 || innerHeight > 450 || !composer.contains(document.activeElement)) return;
            const bounds = composer.getBoundingClientRect();
            if (bounds.top < 0 || bounds.bottom > innerHeight)
                composer.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        });
    });
    window.addEventListener('pagehide', () => {
        if (composerFocusFrame) cancelAnimationFrame(composerFocusFrame);
        composerFocusFrame = 0;
    });

    $('[data-say]').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = $('[data-text]');
        const text = input.value.trim();
        if (!text) return;
        if (connectionState !== 'connected') return toast('Not connected yet. Your draft is still here.');
        if (!app.band && (app.netLock === 'readonly' || app.budget === 'readonly') && !text.startsWith('/')) return toast('Chat is paused. Your draft is still here.');
        // Joining an existing tab selects it without replaying a server join or clearing its history.
        const joined = /^\/join\s+(#[a-z0-9-]{2,30})$/i.exec(text);
        if (joined && app.chans.has(joined[1].toLowerCase())) {
            input.value = '';
            drafts.delete(app.active);
            switchTo(joined[1].toLowerCase());
            return;
        }
        const ordinary = !text.startsWith('/') || text.startsWith('//');
        const record = ordinary ? rememberMessage(text) : null;
        if (ordinary && !record) return;
        const frame = { t: 'say', ch: app.active, text };
        if (record && !record.legacy) frame.clientMessageId = record.id;
        const sent = send(frame);
        if (sent) { input.value = ''; drafts.delete(app.active); drawMessageRecovery(); }
        else if (record) forgetSavedMessage(record);
    });
    $$('[data-quick-line]').forEach((b) => b.addEventListener('click', () => send({ t: 'say', ch: app.active, text: b.dataset.quickLine })));
    $$('[data-quick-me]').forEach((b) => b.addEventListener('click', () => cmd('me', [b.dataset.quickMe])));
    $$('[data-quick-cmd]').forEach((b) => b.addEventListener('click', () => {
        const name = b.dataset.quickCmd;
        if (name === 'slap') { if (app.active.startsWith('pm:')) return cmd('slap'); const c = store(app.active); const others = (c && c.names || []).filter((n) => n.nick !== app.me); const who = others.length ? pick(others) : null; return who ? personCommand(personContext(who.id, c.name, c.keepRef, who.nick), 'slap', [who.nick]) : toast('Nobody here to slap. Yet.'); }
        if (name === 'away') { app.away = !app.away; return cmd('away', app.away ? ['grabbing', 'a', 'snack'] : []); }
        return cmd(name, []);
    }));
    $('[data-leave]').addEventListener('click', () => cmd('part', [app.active]));
    $('[data-pm-off]').addEventListener('change', (e) => cmd('pm', [e.target.checked ? 'off' : 'on']));
    $('[data-cam]').addEventListener('click', () => {
        if (app.localMediaPaused) return toast('Local media stays off while this Stop request is unresolved.');
        const c = store(app.active);
        if (!c) return;
        if (c.myCam) return stopLocalCamera(c.name);
        $('[data-adult]').checked = false;
        return $('[data-cam-gate]').showModal();
    });
    $('[data-cam-yes]').addEventListener('click', () => { if (app.localMediaPaused) return; if (!$('[data-adult]').checked) return toast('Tick the 18+ box first.'); send({ t: 'cam', ch: app.active, on: true, adult18: true }); return $('[data-cam-gate]').close(); });
    $('[data-cam-no]').addEventListener('click', () => $('[data-cam-gate]').close());
    $('[data-jam-help]').addEventListener('toggle', (e) => {
        const help = e.currentTarget, panel = $('[data-jam]');
        if (!help.open || panel.hidden || !currentJam()) return;
        // Reveal the first steps immediately, including while a toast uses
        // workspace height. Keep native keyboard focus on the summary.
        panel.scrollTop += help.getBoundingClientRect().top - panel.getBoundingClientRect().top - 8;
    });
    $('[data-jam-form]').addEventListener('submit', (e) => {
        e.preventDefault();
        const c = currentJam(), input = $('[data-jam-link]');
        if (!c || jamContext?.room !== c || !jamContext.host || !amOp(c)) { clearPendingJamShare(); input.value = ''; return; }
        if (pendingJamShare?.requestId) return; // requestSubmit() must respect the same one-in-flight bound.
        // Copy browser invite produces one HTTPS URL. Only route that explicit
        // paste to the existing server-gated browser hook; keep complete
        // desktop invitations, including sealed replies, byte-for-byte.
        const value = input.value, web = /^https:\/\//i.test(value.trim());
        if (!value) return;
        let sharedValue = web ? value.trim() : value;
        // Match the server's URL spelling only for confirmation. This does
        // not approve an origin or rewrite an opaque desktop invitation.
        if (web) try { sharedValue = new URL(sharedValue).href; } catch { /* The server supplies the rejection. */ }
        let requestId;
        if (jamShareResultsSupported) {
            const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
            requestId = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
        }
        pendingJamShare = { room: c, context: jamContext, value, sharedValue, web, requestId, confirmed: false, deadline: Date.now() + 8000 };
        // Retain the paste until current room state confirms it. Rejection
        // leaves it editable; disconnect/room/power/Stop fences still purge it.
        const args = [web ? 'web' : 'invitation', web ? value.trim() : value];
        const sent = requestId ? send({ t: 'cmd', name: 'jamlink', args, ch: c.name, roomInstance: c.keepRef, jamRequestId: requestId }) : cmd('jamlink', args, c.name);
        if (!sent) { clearPendingJamShare(); $('[data-jam-share-status]').textContent = 'Share was not sent. Your paste is kept.'; }
        else if (requestId && pendingJamShare?.requestId === requestId) waitForJamShare(pendingJamShare);
    });
    $('[data-jam-copy]').addEventListener('click', async () => {
        const c = currentJam(), context = jamContext;
        const link = context?.room === c && context.invitation;
        if (!link) return;
        try {
            await navigator.clipboard.writeText(link);
            if (jamContext === context && currentJam() === c) toast('Invite copied. Open WebJam, choose Join, and paste it there.');
        } catch (_) {
            // Clipboard access is unavailable in some embedded browsers. Keep the
            // invitation in this room only; never place its bearer in storage.
            if (jamContext !== context || currentJam() !== c) return;
            $('[data-jam-copy-fallback]').hidden = false;
            const input = $('[data-jam-copy-value]');
            input.value = link; input.focus(); input.select();
        }
    });
    $('[data-jam-invite-copy]').addEventListener('click', async () => {
        const c = currentJam(), context = jamContext;
        const link = context?.room === c && browserInviteLink(context);
        if (!link) return;
        try {
            await navigator.clipboard.writeText(link);
            if (jamContext === context && currentJam() === c) toast('Browser invite link copied. Send it to your bandmate.');
        } catch (_) {
            if (jamContext !== context || currentJam() !== c) return;
            $('[data-jam-invite-copy-fallback]').hidden = false;
            const input = $('[data-jam-invite-copy-value]');
            input.value = link; input.focus(); input.select();
        }
    });
    $('[data-jam-invite-qr-toggle]').addEventListener('click', () => {
        const c = currentJam(), context = jamContext;
        const link = context?.room === c && browserInviteLink(context);
        if (!link) return;
        const panel = $('[data-jam-invite-qr-panel]');
        const open = panel.hidden;
        panel.hidden = !open;
        const toggle = $('[data-jam-invite-qr-toggle]');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.textContent = open ? 'Hide QR code' : 'Show QR code';
        if (open) {
            drawJamInviteQr(link);
            // Reveal the complete code inside this pane, without scrolling
            // the page or moving the message composer off screen.
            const scroller = $('[data-jam]');
            const bounds = scroller.getBoundingClientRect();
            const bottom = bounds.top + scroller.clientTop + scroller.clientHeight;
            const code = $('[data-jam-invite-qr]').getBoundingClientRect();
            scroller.scrollTop += Math.max(0, code.bottom - bottom + 1);
        } else clearJamInviteQr();
    });

    const sectionButtons = $$('.phonetabs [data-show]');
    function show(pane) {
        document.body.dataset.show = pane;
        sectionButtons.forEach((b) => (b.dataset.show === pane ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
    }
    sectionButtons.forEach((button) => button.addEventListener('click', () => {
        const pane = button.dataset.show;
        show(pane);
        if (pane === 'chat') focusChannelTab(app.active, { preventScroll: false });
        else $(pane === 'rooms' ? '[data-room-directory-title]' : '[data-people-title]').focus();
    }));
    $('.startroom').addEventListener('click', () => {
        show('rooms');
        $('.start-heading').focus();
    });
    show('chat');

    let toastTimer, toastDuration = 4000;
    const toastRegion = $('[data-toast]');
    if (gameGuest) {
        $('[data-gate]').hidden = true;
        $('[data-game-guest-exit-retry]').addEventListener('click', () => void closeGameGuestAccess());
        if (guestInvitationChanged) {
            $('[data-game-guest-connecting]').hidden = false;
            gateStatus('This browser accepted a different invitation. Ask your host for a new invitation for this game.');
        } else if (gameGuestExit) leaveGameGuest(gameGuestExit);
        else {
            $('[data-game-guest-connecting]').hidden = false;
            const cancel = $('[data-game-guest-cancel]');
            cancel.hidden = false;
            cancel.addEventListener('click', () => {
                if (!gameGuestSeated && !sessionEnded) leaveGameGuest('canceled');
            });
            $('[data-game-guest-retry]').addEventListener('click', () => {
                if (gameGuestReloadOffered) {
                    $('[data-game-guest-retry]').disabled = true;
                    gateStatus('Reloading the game…');
                    location.reload();
                } else void connect('');
            });
            void connect('');
        }
    }
    function scheduleToastDismiss() {
        clearTimeout(toastTimer);
        if (toastRegion.hidden || toastRegion.contains(document.activeElement)) return;
        toastTimer = setTimeout(() => {
            if (!toastRegion.contains(document.activeElement)) toastRegion.hidden = true;
        }, toastDuration);
    }
    toastRegion.addEventListener('focusin', () => clearTimeout(toastTimer));
    toastRegion.addEventListener('focusout', () => queueMicrotask(scheduleToastDismiss));
    function toast(text, actions = []) {
        const t = $('[data-toast]');
        t.replaceChildren(text);
        for (const [label, fn] of actions) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn--small'; b.textContent = label; b.addEventListener('click', () => { fn(); t.hidden = true; }); t.append(' ', b); }
        t.hidden = false;
        toastDuration = actions.length ? 12000 : 4000;
        scheduleToastDismiss();
    }
})();
