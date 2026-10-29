/* #stalemate lobby client. Hidden preview. Everything is rendered with textContent;
 * the server enforces permissions, rate limits and public-content policies. */
import { createEntrySiteRegistry, entryBadge, entryReturn, entrySourceFromParams, ENTRY_HANDOFF_KEY, entryHandoff, readEntryHandoff, KEEP_ROOM_INTENT_KEY, KEEP_ROOM_INTENT_TTL, keepRoomIntent, consumeKeepRoomIntent } from '../entry-sites.mjs';
import { createChatAnnouncements } from './chat-announcements.mjs';
import { createEntrySharing } from './entry-sharing.mjs';
(() => {
    'use strict';
    const $ = (s, el = document) => el.querySelector(s);
    const $$ = (s, el = document) => [...el.querySelectorAll(s)];
    const Discovery = window.HangoutDiscovery;
    const params = new URLSearchParams(location.search);
    const readTab = key => { try { return sessionStorage.getItem(key); } catch { return null; } };
    const writeTab = (key, value) => { try { sessionStorage.setItem(key, value); } catch { /* Tab storage is optional for ordinary chat. */ } };
    const removeTab = key => { try { sessionStorage.removeItem(key); } catch { /* A failed Keep read is handled separately. */ } };
    const readRemembered = key => { try { return localStorage.getItem(key); } catch { return null; } };
    const writeRemembered = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Remembering this device is optional. */ } };
    // Only the protected shell adds this marker. Its current display/admission
    // hints also live in memory, independent of optional tab storage.
    const betaShell = !!$('script[src="/beta/bootstrap.js"]');
    const betaBootstrap = betaShell && window.HangoutBootstrap;

    const entrySites = createEntrySiteRegistry(window.HangoutEntrySites);
    let handoff = null;
    try {
        if (params.get('entry-return') === '1') handoff = readEntryHandoff(sessionStorage.getItem(ENTRY_HANDOFF_KEY), Date.now(), entrySites);
        sessionStorage.removeItem(ENTRY_HANDOFF_KEY);
    } catch { /* A blocked tab store must not prevent ordinary chat. */ }
    const entrySource = params.has('via') ? entrySourceFromParams(params, entrySites) : handoff?.source || '';
    let shareEntry = handoff?.share !== false;
    let entrySourcesSupported = null;
    let privateMessageContextSupported = false, privateMessagePeersSupported = false, personTargetsSupported = false;
    let keepSupported = false, keepReturnChecked = false, pendingKeep = null, keepTimer;
    // With an older server, only commands with an explicit target or global
    // meaning are safe in a private tab. Its channel fallback cannot route PM
    // actions, so refuse them locally without clearing the visitor's draft.
    const legacyPrivateCommands = new Set(['join', 'j', 'quit', 'exit', 'bye', 'nick', 'msg', 'm', 'query', 'q', 'whois', 'w', 'who',
        'away', 'ignore', 'unignore', 'list', 'help', 'h', '?', 'accept', 'decline', 'deny', 'block', 'unblock', 'pm',
        'mute', 'gban', 'purge', 'shield', 'shieldoff', 'lobby', 'filter', 'slow', 'approve', 'approveheld',
        'dismiss', 'aidismiss', 'privatereport', 'log', 'delete']);
    let ownerSession = params.get('owner') === '1' || (betaBootstrap ? betaBootstrap.owner === true : readTab('hangout-owner') === '1');
    if (ownerSession) writeTab('hangout-owner', '1');
    const isLocal = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
    // Read the preview key once, then drop the query from the address bar (keeps it out of history,
    // screenshots and page analytics).
    const previewKey = params.get('preview') || (typeof betaBootstrap?.preview === 'string' ? betaBootstrap.preview : '') || readTab('hangout-preview') || '';
    if (params.get('preview')) writeTab('hangout-preview', params.get('preview'));
    const relayBase = ((isLocal && (params.get('relay') || readTab('hangout-relay'))) || $('meta[name="hangout-relay"]').content || '').replace(/\/$/, '');
    const turnUrl = ((isLocal && params.get('turn')) || $('meta[name="hangout-turn"]').content || '').trim();
    if (isLocal && params.get('relay')) writeTab('hangout-relay', params.get('relay'));
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

    const app = window.__lobby = { ws: null, me: '', role: 'fan', band: false, chans: new Map(), pms: new Map(), active: '#stalemate', rooms: [], ignores: new Set(), peerIgnores: new Set(), selfId: '', pending: null, confirmedGathering: null, approvedCreation: null };
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
        if (state !== 'connected') { clearJamInvitations(); if (pendingKeep) clearKeep(pendingKeep.stage === 'submitted' ? 'Keeping this room was not confirmed. Check Host tools after reconnecting.' : 'Your room return was interrupted. Nothing was kept.'); }
        const label = { offline: 'Offline', connecting: 'Connecting…', reconnecting: 'Reconnecting…', connected: 'Connected', ended: 'Session ended' }[state];
        $('[data-connection]').textContent = label;
        $('[data-connection]').dataset.state = state;
        $('[data-send]').disabled = state !== 'connected';
        $('[data-enter]').disabled = state === 'connecting' || state === 'reconnecting' || state === 'ended' && betaShell;
        $('[data-reconnect]').hidden = !(state === 'offline' || state === 'ended' && !betaShell) || !app.me;
        $$('[data-start]').forEach((b) => { b.disabled = state !== 'connected'; });
        if (state === 'offline' && app.pendingChannel) {
            app.pendingChannel = '';
            $('[data-channel-error]').textContent = 'Connection lost. Reconnect and try this channel again.';
        }
        drawCommunity(); drawRooms(); drawMessageRecovery();
    }
    let cancelTransportAck = () => {};
    async function connect(nick) {
        if (sessionEnded && betaShell) return;
        if (savedMessages.size && !confirm('A saved message may already have arrived. Reconnecting clears every saved copy in this tab. Copy any text you need first. Reconnect and clear the copies?')) return;
        clearMessageRecovery(); messageResultsSupported = false;
        sessionEnded = false; $('[data-session-ended]').hidden = true; $('[data-text]').readOnly = false;
        const attempt = ++connectionAttempt;
        cancelTransportAck();
        entrySharing.disconnect();
        privateMessageContextSupported = false; keepSupported = false;
        entrySourcesSupported = null; drawEntryChoice();
        clearTimeout(retryTimer);
        setConnection(app.me ? 'reconnecting' : 'connecting');
        const tsToken = ownerSession ? '' : await loadTurnstile();
        if (attempt !== connectionAttempt) return;
        if (!ownerSession && siteKey && !tsToken) { setConnection('offline'); return gateStatus('The guest check couldn’t finish. Please try again.'); }
        const q = new URLSearchParams({ preview: previewKey });
        const dev = readRemembered('hangout-dev');
        if (dev) q.set('dev', dev);
        if (tsToken) q.set('ts', tsToken);
        if (app.ws) { app.ws.onclose = null; app.ws.onmessage = null; app.ws.close(1000); }
        const ws = new WebSocket(`${relayBase}/${ownerSession ? 'lobby-owner' : 'lobby'}?${q}`);
        app.ws = ws;
        let opened = false;
        let sessionNick = nick;
        let ackTimer, ackSeq = 0, ackFrames = 0, ackSentAt = -Infinity;
        cancelTransportAck = () => { clearTimeout(ackTimer); ackTimer = null; ackFrames = 0; };
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
            if (m.t === 'welcome') sessionNick = m.nick;
            handle(m, sessionNick);
            if (Number.isSafeInteger(m.transportSeq) && m.transportSeq > 0) {
                ackSeq = Math.max(ackSeq, m.transportSeq); ackFrames += 1;
                if (ackFrames >= 8) flushAck();
                else if (!ackTimer) ackTimer = setTimeout(flushAck, 50);
            }
        };
        ws.onclose = (e) => {
            if (attempt !== connectionAttempt) return;
            cancelTransportAck();
            entrySharing.disconnect();
            privateMessageContextSupported = false; privateMessagePeersSupported = false; personTargetsSupported = false; app.selfId = '';
            personPreferencePending = null;
            resetPendingReports();
            uncertainMessages();
            setConnection('offline');
            if (roomApi) roomApi.onLeave();
            if (e.code === 4401) return endSession();
            if (!opened && app.me) return endSession('admission');
            if (ownerSession && !opened) {
                $('[data-gate]').hidden = false; $('[data-app]').hidden = true;
                $('[data-gate-guest]').hidden = false;
                return gateStatus('Email sign-in is unavailable or expired. Sign in again to manage your rooms, or continue as a guest.');
            }
            if (!opened) return gateStatus('Couldn’t get in. Maybe it’s full, locked, or you got the boot. Try again in a bit.');
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
    }
    function endSession(reason = 'expired') {
        const wasVerified = ownerSession || app.verified;
        const privateView = app.active.startsWith('pm:') ? store(app.active) : null;
        endedPmLabel = privateView?.nick ? { key: app.active, nick: privateView.nick }
            : endedPmLabel?.key === app.active ? endedPmLabel : null;
        clearMessageRecovery(); messageResultsSupported = false;
        sessionEnded = true; connectionAttempt++;
        clearTimeout(retryTimer); cancelTransportAck();
        // Keep the unsent text under its original channel/PM key. Never move a
        // private draft into #stalemate or persist it during re-authentication.
        drafts.set(app.active, $('[data-text]').value);
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
        announcements.replace(() => $('[data-buffer]').replaceChildren());
        setConnection('ended'); drawTabs(); drawChan();
        $('[data-text]').readOnly = true;
        const ended = reason === 'left' ? 'You left this chat. Your sign-in and any recorded sharing withdrawal have not been changed.' : reason === 'admission'
            ? 'Couldn’t reconnect. The service may be unavailable or your sign-in may have expired.'
            : wasVerified ? 'Your verified sign-in expired or was revoked.' : 'Your guest session expired or was revoked.';
        const next = reason === 'left' ? 'Return to the community to start a new chat session.' : betaShell
            ? wasVerified ? 'Return to your invitation, then verify your email again to recover your rooms.' : 'Return to your private invitation to join again.'
            : wasVerified ? 'Choose Try again to continue as a guest. Sign in again to recover your registered rooms.' : 'Choose Try again to start a fresh session.';
        $('[data-session-reason]').textContent = `${ended} ${next} Cameras are off.`;
        $('[data-session-reentry]').hidden = !betaShell;
        $('[data-session-reentry]').textContent = reason === 'left' ? 'Return to community' : 'Return to invitation';
        $('[data-session-ended]').hidden = false;
        show('chat'); $('#session-ended-title').focus({ preventScroll: true });
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
        case 'ownership': { const c = store(m.ch); if (c) c.cohosts = m.cohosts; break; }
        case 'owner-offer': toast(`${m.by} offered you ownership of ${m.ch}`, [['Accept ownership', () => { if (confirm(`Accept ownership of ${m.ch}?`)) cmd('acceptowner', [], m.ch); }]]); break;
        case 'sharing-stopped':
            sharingConfirmation++; sharingCleanup = 'confirmed';
            stopLocalSharing();
            if (sharingControls) { drawSharing({ ok: true, state: 'withdrawn', available: false, purposes: [], revision: sharingState?.revision || 0, canStop: true, cleanup: 'confirmed' }); }
            break;
        case 'device': writeRemembered('hangout-dev', m.token); break;
        case 'hello':
            endedPmLabel = null;
            messageResultsSupported = m.features?.messageResults === 1;
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
        case 'entry-source': entrySharing.acknowledge(m); break;
        case 'nick-error': setConnection('offline'); gateStatus(m.text); $('[data-gate]').hidden = false; $('[data-app]').hidden = true; break;
        case 'welcome': {
            if (!app.me || app.resetSession || app.verified !== (m.verified === true)) clearMessageRecovery();
            if (sharingControls) { $('.chat').insertBefore($('[data-sharing-controls]'), $('[data-lobby-welcome]')); $('[data-sharing-leave]').disabled = false; }
            const wasIn = !!app.me;
            if (!wasIn) count('lobby-join');
            app.verified = m.verified === true; app.capabilities = m.capabilities || app.capabilities;
            $('[data-room-filter] option[value=mine]').disabled = !app.verified;
            app.me = m.nick; app.selfId = personId(m.id) ? m.id : '';
            for (const view of app.pms.values()) updatePmName(view, view.nick);
            app.band = m.band; writeRemembered('hangout-nick', m.nick);
            $('[data-self-nick]').textContent = m.nick;
            $('[data-self-role]').textContent = app.capabilities.configure ? 'Site administrator' : app.capabilities.moderate ? 'Community moderator' : app.verified ? 'Room owner account' : 'Guest access';
            app.kicked = false; retry = 0; setConnection('connected');
            entrySharing.joined();
            returnToKeepRoom();
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
            if (pendingKeep?.stage === 'joining' && c.name === pendingKeep.room) {
                if (c.keepRef === pendingKeep.ref) pendingKeep.stage = 'confirm';
                else clearKeep('That room changed while you signed in. Nothing was kept.');
            }
            // Classic IRC: joining begins a fresh buffer; never render pre-join backlog.
            if (activityRoom(c)) c.actSnap = activitySnapshot(m.act);
            switchTo(m.ch.name, { freshJoin: true });
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
                if (personPreferencePending) { personPreferencePending = null; personSheetStatus('That preference was not confirmed. Check the current person and try again.'); }
                if (pendingKeep) clearKeep();
                resetPendingReports();
                if (app.pendingChannel && $('[data-channel-dialog]').open) {
                    $('[data-channel-error]').textContent = m.text;
                    app.pendingChannel = '';
                } else toast(m.text);
            }
            break;
        case 'denied': if (personPreferencePending) { personPreferencePending = null; personSheetStatus('That preference was not confirmed. Check the current person and try again.'); } if (pendingKeep) clearKeep(); line(app.active, { notice: true, from: 'StaleBot', text: m.text, kind: 'error' }); break;
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
        case 'invite': toast(`${m.by} invited you to ${m.ch}`, [['Join', () => cmd('join', [m.ch])]]); break;
        case 'kicked': {
            app.kicked = m.ch === '#stalemate';
            toast(`${m.banned ? 'Banned' : 'Kicked'} from ${m.ch} by ${m.by}: ${m.reason}`);
            if (app.kicked) {
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
    function finishReport(id, submitted) {
        const pending = pendingReports.get(id);
        if (pending) { clearTimeout(pending.timer); pendingReports.delete(id); }
        if (submitted) for (const c of [...app.chans.values(), ...app.pms.values()]) {
            const l = c.lines.find((line) => line.id === id); if (l) l.reported = true;
        }
        const button = pending?.button || $$('[data-id]').find((line) => line.dataset.id === id)?.querySelector('.flag');
        if (button) {
            button.disabled = submitted;
            button.textContent = submitted ? '✓' : '🚩';
            button.title = submitted ? REPORT_QUEUED_LABEL : 'Report this message';
            if (submitted) button.setAttribute('aria-label', REPORT_QUEUED_LABEL);
        }
    }
    function resetPendingReports() { for (const id of [...pendingReports.keys()]) finishReport(id, false); }
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
                if (l.reported) { r.disabled = true; r.textContent = '✓'; r.title = REPORT_QUEUED_LABEL; r.setAttribute('aria-label', REPORT_QUEUED_LABEL); }
                else if (pendingReports.has(l.id)) { r.disabled = true; r.textContent = '…'; pendingReports.get(l.id).button = r; }
                r.addEventListener('click', () => {
                    if (!send({ t: 'report', id: l.id, text: l.text })) return toast('You are offline. Reconnect before reporting this message.');
                    r.disabled = true; r.textContent = '…';
                    const timer = setTimeout(() => { finishReport(l.id, false); toast('Report confirmation did not arrive. Try again or use the moderation contact.'); }, 10000);
                    pendingReports.set(l.id, { button: r, timer });
                });
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

    function switchTo(key, { freshJoin = false } = {}) {
        const prev = app.active;
        if (prev !== key) { drafts.set(prev, $('[data-text]').value); $('[data-text]').value = drafts.get(key) || ''; }
        app.active = key;
        const c = store(key);
        if (c) { c.unread = 0; c.mentions = 0; }
        belowFold = 0; drawNewMessages(); replaying = true;
        announcements.replace(() => {
            $('[data-buffer]').replaceChildren();
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
    function resetJamControls() {
        $('[data-jam]').hidden = true;
        const desktop = $('[data-jam-desktop]'); desktop.hidden = true; desktop.removeAttribute('href');
        $('[data-jam-copy]').hidden = true;
        $('[data-jam-copy-fallback]').hidden = true; $('[data-jam-copy-value]').value = '';
        $('[data-jam-link]').value = ''; $('[data-jam-form]').hidden = true;
        $('[data-jam-wait]').hidden = false;
        const web = $('[data-jam-web]'); web.disabled = true; web.onclick = null; web.textContent = 'Browser join unavailable';
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
    function drawJam() {
        if (app.sharingStopped || app.localMediaPaused) { resetJamControls(); $('[data-jam]').hidden = true; return; }
        const c = currentJam();
        const next = c ? { room: c, host: !!amOp(c), invitation: c.jam?.invitation || c.jam?.desktop || '',
            desktop: c.jam?.desktop || '', web: c.jam?.web || '', webReady: c.jam?.webReady === true } : null;
        const unchanged = jamContext && next && Object.keys(next).every(key => next[key] === jamContext[key]);
        // The shared host editor belongs to one room and current authority.
        // Presence redraws keep it; switching, replacement or power loss clears it.
        if (!unchanged) { resetJamControls(); jamContext = next; }
        if (!next) return;
        $('[data-jam]').hidden = false; $('[data-jam-form]').hidden = !next.host;
        const desktop = $('[data-jam-desktop]');
        desktop.hidden = !next.desktop;
        if (/^webjam:\/\//.test(next.desktop)) desktop.setAttribute('href', next.desktop);
        else desktop.removeAttribute('href');
        $('[data-jam-wait]').hidden = !!(next.invitation || next.webReady); $('[data-jam-copy]').hidden = !next.invitation;
        const web = $('[data-jam-web]'); web.disabled = !next.webReady;
        web.textContent = web.disabled ? 'Browser join unavailable' : 'Join in browser (higher delay)';
        web.title = web.disabled ? 'The host has not shared an approved browser invitation' : 'Open the host’s browser invitation; headphones and audio consent are required there';
        const context = jamContext;
        web.onclick = () => {
            if (jamContext === context && currentJam() === context.room && context.webReady && /^https:\/\//.test(context.web))
                window.open(context.web, '_blank', 'noopener,noreferrer');
        };
    }
    function drawChan() {
        drawKeepPrompt();
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
            cam.hidden = app.localMediaPaused || c.kind === 'chat';
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
        count(`room-start-${b.dataset.start}`); cmd('join', [`#${b.dataset.start}-${slug()}`]);
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
    function openPalette(ops) {
        const box = $('[data-palette-buttons]');
        const current = store(app.active);
        const origin = { channel: app.active, instance: current?.keepRef };
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
        if (ops && owner) for (const host of current.cohosts || []) {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn--small'; b.textContent = `Remove verified co-host: ${host.label}`;
            b.disabled = !personTargetsSupported || !roomNonce(origin.instance);
            b.addEventListener('click', () => {
                if (!confirm(`Remove ${host.label} as a verified co-host?`)) return;
                if (!personTargetsSupported || !roomNonce(origin.instance) || app.chans.get(origin.channel)?.keepRef !== origin.instance) return toast('That room changed. Choose current Host tools before trying again.');
                if (send({ t: 'cmd', name: 'cohost', args: ['remove', host.id], ch: origin.channel, roomInstance: origin.instance, cohostAccount: true })) $('[data-palette]').close();
                else toast('Co-host removal was not sent. Reconnect before trying again.');
            }); box.append(b);
        }
        $('[data-palette]').showModal();
    }
    $('[data-palette-open]').addEventListener('click', () => openPalette(false));
    $('[data-roomtools]').addEventListener('click', () => openPalette(true));
    $('[data-palette-close]').addEventListener('click', () => $('[data-palette]').close());

    let inviteInstance = '', invitePeople = new Map();
    function closeInviteDialog() {
        inviteInstance = ''; invitePeople.clear();
        inviteContext = null; $('[data-invite-nick]').value = ''; $('[data-invite-options]').replaceChildren();
        if ($('[data-invite-dialog]').open) $('[data-invite-dialog]').close();
    }
    function openInviteDialog() {
        const current = store(app.active);
        if (connectionState !== 'connected' || !current || current.kind === 'lobby' || !amOp(current)) return;
        inviteContext = current; inviteInstance = current.keepRef; invitePeople.clear(); $('[data-invite-room]').textContent = current.name; $('[data-invite-error]').textContent = '';
        $('[data-invite-nick]').value = ''; $('[data-invite-options]').replaceChildren();
        const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose a current person'; $('[data-invite-options]').append(placeholder);
        for (const person of app.chans.get('#stalemate')?.names || []) {
            if (!personId(person.id) || person.id === app.selfId || current.names.some(member => member.id === person.id)) continue;
            const context = personContext(person.id, current.name, inviteInstance, person.nick);
            invitePeople.set(person.id, context);
            const option = document.createElement('option'); option.value = person.id; option.textContent = person.nick; $('[data-invite-options]').append(option);
        }
        $('[data-invite-person-send]').disabled = !personTargetsSupported || !roomNonce(inviteInstance);
        $('[data-invite-dialog]').showModal(); $('[data-invite-nick]').focus();
    }
    $('[data-invite-cancel]').addEventListener('click', closeInviteDialog);
    $('[data-invite-dialog]').addEventListener('close', () => {
        if ($('[data-invite-dialog]').open) return;
        closeInviteDialog();
        if (connectionState === 'connected') $(amOp(store(app.active)) ? '[data-roomtools]' : '[data-text]').focus({ preventScroll: true });
    });
    $('[data-invite-person-send]').addEventListener('click', () => {
        const current = store(app.active), context = invitePeople.get($('[data-invite-options]').value);
        if (!inviteContext || inviteContext !== current || current.keepRef !== inviteInstance || !amOp(current) || !context) {
            $('[data-invite-error]').textContent = 'Choose a current person in the original room.'; return;
        }
        // Invitation target may be outside this room, but must remain the
        // original live connection in the shared lobby's current roster.
        const person = findPerson(context.peer);
        if (!person || !personContextValid(context)) { $('[data-invite-error]').textContent = 'That person is no longer confirmed.'; return; }
        if (send({ t: 'cmd', name: 'invite', args: [person.nick, current.name], ch: context.channel, roomInstance: context.instance, personContext: 1, personPeer: context.peer })) closeInviteDialog();
        else $('[data-invite-error]').textContent = 'The invitation was not sent. Reconnect before trying again.';
    });
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
        if (namedCmd('invite', [nick], current.name, inviteInstance)) closeInviteDialog();
        else $('[data-invite-error]').textContent = 'Reconnect before sending an invitation.';
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
    $('[data-jam-form]').addEventListener('submit', (e) => {
        e.preventDefault();
        const c = currentJam(), input = $('[data-jam-link]');
        if (!c || jamContext?.room !== c || !jamContext.host || !amOp(c)) { input.value = ''; return; }
        // Copy web invite produces one HTTPS URL. Only route that explicit
        // paste to the existing server-gated browser hook; keep complete
        // desktop invitations, including sealed replies, byte-for-byte.
        const value = input.value, web = /^https:\/\//i.test(value.trim());
        if (value && cmd('jamlink', [web ? 'web' : 'invitation', web ? value.trim() : value], c.name)) input.value = '';
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

    function show(pane) {
        document.body.dataset.show = pane;
        $$('[data-show]').forEach((b) => (b.dataset.show === pane ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
    }
    $$('[data-show]').forEach((b) => b.addEventListener('click', () => show(b.dataset.show)));
    show('chat');

    let toastTimer, toastDuration = 4000;
    const toastRegion = $('[data-toast]');
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
