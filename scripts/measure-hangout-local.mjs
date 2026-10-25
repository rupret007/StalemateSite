// Isolated loopback measurement, never a production load generator.
// node scripts/measure-hangout-local.mjs --clients 50 --rounds 5 [--rooms 10]
// Uses actual local WebSockets/engine/default caps; synthetic peers, no providers.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { setTimeout as pause } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import { startRelay } from './hangout-relay-dev.mjs';
import { DELIVERY_LIMITS } from '../hangout-worker/src/socket-delivery.mjs';
import { LOBBY_LIMITS } from '../hangout-worker/src/lobby-core.mjs';

const PREVIEW = 'local-preview-key-0001';
const ORIGIN = 'http://127.0.0.1:4320';
const word = number => { let value = number + 1, out = ''; while (value) { value -= 1; out = String.fromCharCode(97 + value % 26) + out; value = Math.floor(value / 26); } return out; };
const percentiles = samples => {
    const sorted = [...samples].sort((a, b) => a - b);
    const p = fraction => sorted.length ? Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)].toFixed(3)) : null;
    return { samples: sorted.length, p50Ms: p(.5), p95Ms: p(.95), p99Ms: p(.99), maxMs: sorted.length ? Number(sorted.at(-1).toFixed(3)) : null };
};

export async function measureLocalCommunity({ clients = 50, rounds = 5, rooms = 0 } = {}) {
    if (!Number.isInteger(clients) || clients < 2 || clients > 150 || !Number.isInteger(rounds) || rounds < 1 || rounds > Math.min(20, clients)
        || !Number.isInteger(rooms) || rooms < 0 || rooms > Math.min(30, clients) || rooms && Math.ceil(clients / rooms) > 8) {
        throw new Error('Use 2–150 clients, 1–20 rounds no greater than clients, and 0–30 rooms with at most 8 clients per room.');
    }
    const began = performance.now(), deadline = began + 90000, startedAt = new Date().toISOString();
    const stored = new Map(), writes = {}, peers = new Set(), markers = new Map(), memory = process.memoryUsage();
    let peakRss = memory.rss, peakHeap = memory.heapUsed, relay;
    const memoryTimer = setInterval(() => { const sample = process.memoryUsage(); peakRss = Math.max(peakRss, sample.rss); peakHeap = Math.max(peakHeap, sample.heapUsed); }, 100);
    const launch = () => startRelay({ origins: ORIGIN, initialState: Object.fromEntries(stored), persist: (kind, value) => {
        writes[kind] = (writes[kind] || 0) + 1;
        stored.set(kind, structuredClone(kind === 'modlog' ? [...(stored.get(kind) || []), value].slice(-2000) : value));
    } });
    const waitFor = (peer, test, label) => {
        if (test()) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const waiter = { test, resolve, reject, timer: setTimeout(() => { peer.waiters.delete(waiter); reject(new Error(`Timed out: ${label}; peer=${peer.nick}, closed=${peer.closed} ${peer.closeReason || ''}, frames=${peer.frames}, notices=${JSON.stringify(peer.notices)}, metrics=${JSON.stringify(relay.metrics())}`)); }, Math.max(1, Math.min(5000, deadline - performance.now()))) };
            peer.waiters.add(waiter);
        });
    };
    const connect = async (nick, index, { token = '', acknowledge = true } = {}) => {
        assert(performance.now() < deadline, 'Local measurement exceeded its 90-second ceiling');
        const url = new URL(`ws://127.0.0.1:${relay.port}/lobby`);
        url.searchParams.set('preview', PREVIEW); if (token) url.searchParams.set('dev', token);
        const ws = new WebSocket(url, { headers: { Origin: ORIGIN, 'x-test-ip': `192.0.2.${index + 1}` } });
        const peer = { ws, nick, token, ready: false, historyOffered: false, received: new Set(), waiters: new Set(), closed: null, frames: 0, bytes: 0, acked: 0, notices: [] };
        peers.add(peer); let latest = 0, sinceAck = 0, timer, ackSentAt = -Infinity;
        const notify = () => { for (const waiter of peer.waiters) if (waiter.test()) { clearTimeout(waiter.timer); peer.waiters.delete(waiter); waiter.resolve(); } };
        const flush = () => {
            clearTimeout(timer); timer = null;
            if (latest > peer.acked && ws.readyState === WebSocket.OPEN) {
                const remaining = 50 - (performance.now() - ackSentAt);
                if (remaining > 0) { timer = setTimeout(flush, remaining); return; }
                ws.send(JSON.stringify({ t: 'transport-ack', seq: latest })); peer.acked = latest; sinceAck = 0; ackSentAt = performance.now();
            }
        };
        ws.on('message', raw => {
            peer.frames += 1; peer.bytes += raw.byteLength;
            const frame = JSON.parse(String(raw));
            if (frame.t === 'notice' && typeof frame.text === 'string') peer.notices = [...peer.notices, frame.text].slice(-4);
            if (frame.t === 'device') peer.token = frame.token;
            if (frame.t === 'hello') ws.send(JSON.stringify({ t: 'hello', nick, age13: true, transport: 1 }));
            if (frame.t === 'join' && frame.ch.name === '#stalemate') peer.ready = true;
            if (frame.t === 'join' && (Object.hasOwn(frame, 'history') || Object.hasOwn(frame.ch, 'history'))) peer.historyOffered = true;
            if (frame.t === 'chan') peer.channel = frame.ch;
            if (frame.t === 'list') peer.rooms = frame.rooms;
            if (frame.t === 'line' && typeof frame.text === 'string' && frame.text.startsWith('Loopback marker ')) {
                peer.received.add(frame.text);
                const marker = markers.get(frame.text);
                if (marker && marker.expected.has(peer)) { marker.expected.delete(peer); marker.latencies.push(performance.now() - marker.started); }
            }
            if (acknowledge && Number.isSafeInteger(frame.transportSeq) && frame.transportSeq > latest) {
                latest = frame.transportSeq; sinceAck += 1;
                if (sinceAck >= 8) flush(); else if (!timer) timer = setTimeout(flush, 50);
            }
            notify();
        });
        ws.on('close', (code, reason) => { clearTimeout(timer); peer.closed = code; peer.closeReason = reason.toString(); notify(); });
        ws.on('error', () => { peer.failed = true; for (const waiter of peer.waiters) { clearTimeout(waiter.timer); waiter.reject(new Error('Local WebSocket failed')); } peer.waiters.clear(); });
        await waitFor(peer, () => peer.ready || peer.failed || peer.closed !== null, 'guest join');
        assert(peer.ready && !peer.failed && peer.closed === null, 'Local guest admission failed');
        return peer;
    };
    const sendMarker = async (writer, recipients, label, channel = '#stalemate') => {
        const text = `Loopback marker ${label}`;
        const marker = { expected: new Set(recipients), latencies: [], started: performance.now() }; markers.set(text, marker);
        writer.ws.send(JSON.stringify({ t: 'say', ch: channel, text }));
        await Promise.all(recipients.map(peer => waitFor(peer, () => peer.received.has(text), `message ${label} in ${channel} from ${writer.nick}`)));
        assert.equal(marker.expected.size, 0, 'Missing expected local delivery');
        return marker.latencies;
    };
    const terminate = async peer => {
        if (peer.closed !== null) return;
        peer.ws.terminate(); await waitFor(peer, () => peer.closed !== null, 'socket closure');
    };
    try {
        relay = await launch();
        const joined = [], joins = [];
        for (let index = 0; index < clients; index += 1) {
            const before = performance.now(); joined.push(await connect(`LoadGuest${word(index)}`, index)); joins.push(performance.now() - before);
        }
        let admission = null;
        if (clients === LOBBY_LIMITS.lobbyMax) {
            const status = await new Promise((resolve, reject) => {
                const extra = new WebSocket(`ws://127.0.0.1:${relay.port}/lobby?preview=${PREVIEW}`,
                    { headers: { Origin: ORIGIN, 'x-test-ip': '192.0.2.250' } });
                const timer = setTimeout(() => { extra.terminate(); reject(new Error('Full-lobby admission did not finish')); }, 5000);
                extra.on('error', () => {});
                extra.on('unexpected-response', (_request, response) => {
                    clearTimeout(timer); response.resume(); extra.terminate(); resolve(response.statusCode);
                });
                extra.on('open', () => { clearTimeout(timer); extra.terminate(); reject(new Error('Full lobby admitted an extra guest')); });
            });
            assert.equal(status, 429, 'The unchanged guest cap must reject excess admission');
            admission = { existingGuestLimit: LOBBY_LIMITS.lobbyMax, excessGuestHttpStatus: status };
        }
        const hot = [];
        for (let i = 0; i < rounds; i += 1) hot.push(...await sendMarker(joined[i], joined, `lobby ${word(i)}`));
        let wide = null;
        if (rooms) {
            const channels = Array.from({ length: rooms }, (_, i) => `#load-room-${word(i)}`);
            for (let i = 0; i < joined.length; i += 1) {
                const peer = joined[i], channel = channels[i % rooms];
                peer.ws.send(JSON.stringify({ t: 'cmd', name: 'join', args: [channel], ch: '#stalemate' }));
                await waitFor(peer, () => peer.channel?.name === channel, 'creative channel admission');
            }
            const latencies = [];
            for (let i = 0; i < Math.max(rounds, rooms); i += 1) {
                const channel = channels[i % rooms], recipients = joined.filter((_, index) => index % rooms === i % rooms);
                latencies.push(...await sendMarker(joined[i], recipients, `room ${word(i)}`, channel));
            }
            wide = { rooms, messages: Math.max(rounds, rooms), delivery: percentiles(latencies) };
        }
        await pause(3100); // Keep the unchanged per-person lobby slow mode.
        const departed = joined.pop(), token = departed.token; await terminate(departed);
        await pause(25);
        await sendMarker(joined[0], joined, 'while disconnected');
        const returned = await connect('LoadReturnGuest', clients - 1, { token }); joined.push(returned);
        assert.equal(returned.received.size, 0, 'A reconnect must not receive earlier chat');
        await sendMarker(joined[1], joined, 'after reconnect');
        assert.deepEqual([...returned.received], ['Loopback marker after reconnect']);
        assert.equal(returned.historyOffered, false, 'A reconnect must not be offered a hidden history payload');

        // An explicitly unacknowledging protocol peer demonstrates window
        // retirement; this is not claimed as a physical slow-TCP-reader test.
        await terminate(returned); joined.pop(); await pause(25);
        const probe = await connect('NoAckGuest', clients - 1, { acknowledge: false });
        for (let i = 0; i < 15 && probe.closed === null; i += 1) {
            probe.ws.send(JSON.stringify({ t: 'cmd', name: 'help', args: [], ch: '#stalemate' }));
            await pause(i < 8 ? 25 : 1100); // Respect the unchanged ten-command burst/refill.
        }
        await waitFor(probe, () => probe.closed !== null, 'unacknowledging peer retirement');
        assert.equal(probe.closed, 4413);
        await sendMarker(joined[0], joined, 'healthy after pressure');
        const churnCount = Math.min(16, Math.floor(joined.length / 2));
        let reconnectBurst = null;
        if (churnCount) {
            const leaving = joined.splice(-churnCount), churnStart = performance.now();
            await Promise.all(leaving.map(terminate));
            const rejoined = await Promise.all(leaving.map((peer, index) => connect(`BurstReturn${word(index)}`, clients - 2 - index, { token: peer.token })));
            for (const peer of rejoined) {
                assert.equal(peer.received.size, 0, 'Burst reconnects must not receive earlier chat');
                assert.equal(peer.historyOffered, false);
            }
            joined.push(...rejoined);
            await sendMarker(rejoined[0], joined, 'after burst reconnect');
            reconnectBurst = { simultaneousGuests: churnCount, allRejoined: true, noBacklog: true,
                elapsedMs: Number((performance.now() - churnStart).toFixed(3)) };
        }
        const beforeRestart = relay.metrics();
        assert(beforeRestart.delivery.pressureCloses >= 1);
        assert.equal(beforeRestart.controlBudget.consumedControls, beforeRestart.delivery.controlFrames);
        assert(beforeRestart.controlBudget.prepaidControls >= beforeRestart.controlBudget.consumedControls);
        const requestAccounting = { sharedLimit: 40000, sharedUsedBeforeRestart: relay.lobby.snapshot().budget.requests,
            controlRequestUnitsReserved: beforeRestart.controlBudget.reservations,
            controlRequestUnitsConsumedAt20To1: beforeRestart.controlBudget.consumedControls / 20,
            unusedPrepaidControlSlots: beforeRestart.controlBudget.prepaidControls - beforeRestart.controlBudget.consumedControls,
            networkStateWritesBeforeRestart: writes.net || 0,
            note: 'Request units only. Duration, storage rows, calling Workers and account-wide usage require separate hosted qualification.' };
        assert.equal(joined.some(peer => peer.closed !== null), false, 'Healthy peers must remain connected');
        const persisted = JSON.stringify(Object.fromEntries(stored));
        assert.equal(persisted.includes('Loopback marker '), false, 'Ordinary chat text must not be persisted');
        for (const peer of joined) await terminate(peer);
        await relay.close(); relay = await launch();
        const first = await connect('RestartGuestAlpha', 0, { token: joined[0].token });
        const second = await connect('RestartGuestBeta', 1, { token: joined[1]?.token });
        assert.equal(first.received.size, 0); assert.equal(second.received.size, 0);
        if (rooms) await waitFor(first, () => first.rooms?.length === rooms, 'restored room directory');
        await sendMarker(first, [first, second], 'after restart');
        assert.deepEqual([...first.received], ['Loopback marker after restart']);
        assert.deepEqual([...second.received], ['Loopback marker after restart']);
        assert.equal(first.historyOffered || second.historyOffered, false);
        const afterRestart = relay.metrics();
        return {
            version: 1, scope: 'isolated loopback real WebSockets and application engine; no production requests', startedAt,
            parameters: { clients, rounds, rooms }, elapsedMs: Number((performance.now() - began).toFixed(3)),
            join: percentiles(joins), hotLobby: { messages: rounds, delivery: percentiles(hot) }, manyRooms: wide,
            admission,
            recovery: { reconnectHasNoBacklog: true, reconnectBurst, restartHasNoBacklog: true, restoredRooms: rooms, ordinaryChatAbsentFromStoredState: true },
            pressure: { unacknowledgingPeerCloseCode: probe.closed, healthyPeersContinued: true, limits: DELIVERY_LIMITS },
            requestAccounting, beforeRestart, afterRestart,
            memory: { initialRssBytes: memory.rss, peakRssBytes: peakRss, initialHeapBytes: memory.heapUsed, peakHeapBytes: peakHeap },
            limitations: ['Loopback Node relay is not Cloudflare capacity, geographic latency or field performance.',
                'Persistence uses a local memory adapter, not deployed storage or Cloudflare Access.',
                'The pressure peer consumes frames but withholds acknowledgements; physical TCP/browser suspension needs separate qualification.',
                'Native audio, media providers, TURN and real moderator/owner sign-in are not exercised.']
        };
    } finally {
        clearInterval(memoryTimer);
        for (const peer of peers) { for (const waiter of peer.waiters) clearTimeout(waiter.timer); peer.waiters.clear(); peer.ws.terminate(); }
        if (relay) await relay.close();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const { values } = parseArgs({ options: { clients: { type: 'string', default: '50' }, rounds: { type: 'string', default: '5' }, rooms: { type: 'string', default: '0' } } });
    measureLocalCommunity({ clients: Number(values.clients), rounds: Number(values.rounds), rooms: Number(values.rooms) })
        .then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
        .catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
