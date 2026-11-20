import { musicSignal } from './request-signal.js';
import { acquireMusicStream } from './audio.js';
import { RELAY_ORIGIN } from './config.js';
import { readInvite, toBase64Url } from './crypto.js';
import { BrowserMusicHost } from './host-session.js';
import { validateCredentials } from './policy.js';

const $ = id => document.getElementById(id);
const start = $('start'), stop = $('stop'), listen = $('listen'), headphones = $('headphones'), status = $('status');
const audio = $('guest-audio');
let handoff;
try {
    handoff = JSON.parse(sessionStorage.getItem('private-music-host'));
    sessionStorage.removeItem('private-music-host');
} catch { /* An admitted host still needs the original tab handoff. */ }
const ref = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
if (!ref(handoff?.request) || !/^[a-f0-9]{64}$/.test(handoff?.webjam) || !/^[a-f0-9]{64}$/.test(handoff?.proof)
    || !Number.isInteger(handoff.generation) || !Number.isSafeInteger(handoff.expires) || handoff.expires <= Date.now()) {
    status.textContent = 'Open a current Music host invitation from your Jam room.';
} else {
    const MUSIC_HEARTBEAT_WINDOW_MS = 15000;
    const controller = new AbortController();
    const channel = new BroadcastChannel(`webjam-browser-host-${handoff.request}`);
    let session, stream, heartbeat, deadlineTimer, checking, lastCheck = 0;
    const expired = () => end('The Music connection ended. Start a fresh invitation to rejoin.');
    const end = message => {
        if (controller.signal.aborted) return;
        controller.abort();
        clearInterval(heartbeat);
        clearTimeout(deadlineTimer);
        session?.close();
        session = null;
        stream?.getTracks().forEach(track => track.stop());
        stream = null;
        audio.pause(); audio.srcObject = null;
        start.disabled = true; stop.hidden = true; listen.hidden = true;
        status.textContent = message;
        channel.postMessage({ type: 'ended' }); channel.close();
        void request('host-stop').catch(() => {
            status.textContent = `${message} The room did not confirm the stop.`;
        });
        handoff = null;
    };
    async function request(op) {
        const closing = op === 'host-stop';
        const sentAt = Date.now();
        const deadline = AbortSignal.timeout(8000);
        const response = await fetch('/beta/music', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
            headers: { 'Content-Type': 'application/json' }, keepalive: closing,
            signal: closing ? deadline : musicSignal(controller.signal, deadline),
            body: JSON.stringify({ op, id: handoff.webjam.slice(-32), proof: handoff.proof, webjam: handoff.webjam, generation: handoff.generation }) });
        if (op === 'host-check' && response.status === 503 && (await response.json().catch(() => null))?.error === 'busy') return false;
        if (!response.ok) throw new Error('Music authority ended.');
        const value = await response.json();
        if (!closing && !controller.signal.aborted) {
            const receivedAt = Date.now();
            if (receivedAt >= sentAt + MUSIC_HEARTBEAT_WINDOW_MS
                || (lastCheck && receivedAt >= lastCheck + MUSIC_HEARTBEAT_WINDOW_MS)) {
                throw new Error('Music authority ended.');
            }
            lastCheck = Math.max(lastCheck, sentAt);
            clearTimeout(deadlineTimer);
            deadlineTimer = setTimeout(expired, Math.max(0, lastCheck + MUSIC_HEARTBEAT_WINDOW_MS - Date.now()));
        }
        return value;
    }
    async function play() {
        if (!audio.srcObject || controller.signal.aborted) return;
        try { await audio.play(); listen.hidden = true; }
        catch { if (!controller.signal.aborted) listen.hidden = false; }
    }
    async function confirmAuthority() {
        try {
            while (!controller.signal.aborted && Date.now() < lastCheck + MUSIC_HEARTBEAT_WINDOW_MS) {
                if (await request('host-check') !== false) return !controller.signal.aborted;
                // A staged room write must settle before this check can renew authority.
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        } catch { /* A terminal response or failed request closes capture. */ }
        expired();
        return false;
    }
    function check() {
        if (!lastCheck || controller.signal.aborted) return false;
        checking ??= confirmAuthority().finally(() => { checking = null; });
        return checking;
    }
    status.textContent = 'Confirm headphones and start when you’re ready to invite your guest.';
    headphones.addEventListener('change', () => { if (!stream && !controller.signal.aborted) start.disabled = !headphones.checked; });
    start.addEventListener('click', async event => {
        if (!event.isTrusted || !headphones.checked || start.disabled || controller.signal.aborted) return;
        start.disabled = true; headphones.disabled = true; stop.hidden = false;
        status.textContent = 'Allow microphone access to host Music.';
        try {
            const { stream: captured } = await acquireMusicStream(navigator.mediaDevices);
            captured.getAudioTracks().forEach(track => { track.enabled = false; });
            if (controller.signal.aborted) { captured.getTracks().forEach(track => track.stop()); return; }
            stream = captured;
            controller.signal.throwIfAborted();
            for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => end('The microphone stopped.'));
            const credentials = validateCredentials(await request('host-join'));
            controller.signal.throwIfAborted();
            heartbeat = setInterval(check, 4000);
            const expires = Math.floor(Math.min(handoff.expires, credentials.expiresAt) / 1000);
            const capability = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
            const href = `${location.origin}/join/#k=${capability}&s=${handoff.webjam}&g=${handoff.generation}&e=${expires}`;
            const invite = readInvite(new URL(href).hash);
            session = new BrowserMusicHost({ origin: RELAY_ORIGIN, invite, stream, audioContext: { baseLatency: 0 },
                onTrack: remote => { audio.srcObject = remote; void play(); },
                onError: () => end('The Music session ended. Start a fresh invitation to rejoin.') });
            status.textContent = 'Preparing secure Music audio…';
            await session.host(credentials, () => {
                channel.postMessage({ type: 'offer', href });
                status.textContent = 'Waiting for your guest to accept the invitation and enable audio.';
            });
            status.textContent = 'Connected to your guest.';
        } catch { end('Music could not start. Return to the Jam room for a fresh invitation.'); }
    });
    channel.addEventListener('message', ({ data }) => { if (data?.type === 'stop') end('The Music invitation ended.'); });
    stop.addEventListener('click', () => end('Music stopped. You can return to the Jam room.'));
    listen.addEventListener('click', play);
    document.addEventListener('visibilitychange', async () => {
        if (!document.hidden && await check() && !document.hidden) void play();
    });
    window.addEventListener('pagehide', () => end('Music stopped.'), { once: true });
}
