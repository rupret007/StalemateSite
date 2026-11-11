// Local comparison only. Run with Node 24+ after installing the locked runtime
// fixture dependencies. Both backends bind to loopback and use disposable data.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import { WebSocket, WebSocketServer } from 'ws';
import { TurdtrisMatch } from '../../hangout-worker/arcade/games/turdtris-match.js';
import { Miniflare, convertV4MiniflareOptions } from './durable-records/node_modules/miniflare/dist/src/index.js';

const directory = await mkdtemp(join(tmpdir(), 'turdtris-host-comparison-'));
const id = 'sprint-host-comparison', seed = 0x6db74e01;
const seats = ['a', 'b', 'spectator'];
let worker, bundle, db, server;

// Use the same stored match and payload on both reference transports.
const view = (game, seat) => JSON.stringify(game.view(seat, Date.now()));
function command(game, seat, payload) {
    const outcome = game.command(seat, JSON.parse(payload), Date.now());
    if (!outcome.ok) throw Error('Fixture command refused: ' + outcome.reason);
}

async function isolatedWorker() {
    const path = fileURLToPath(new URL('../../hangout-worker/arcade/games/turdtris-match.js', import.meta.url));
    const source = join(directory, 'isolated.mjs');
    await writeFile(source, `
import { TurdtrisMatch } from ${JSON.stringify(path)};
const view = ${view.toString()};
${command.toString()}
export class Race {
    constructor(state) { this.state = state; }
    async fetch(request) {
        return this.state.blockConcurrencyWhile(async () => {
            const seat = new URL(request.url).pathname.slice(1);
            let saved = await this.state.storage.get('race');
            if (!saved) {
                saved = new TurdtrisMatch(${JSON.stringify(id)}, Date.now(), null, ${seed}).checkpoint();
                await this.state.storage.put('race', saved);
            }
            const [client, server] = Object.values(new WebSocketPair());
            this.state.acceptWebSocket(server, [seat]);
            server.send(view(TurdtrisMatch.restore(saved), seat));
            return new Response(null, { status: 101, webSocket: client });
        });
    }
    async webSocketMessage(socket, payload) {
        await this.state.blockConcurrencyWhile(async () => {
            const seat = this.state.getTags(socket)[0];
            const game = TurdtrisMatch.restore(await this.state.storage.get('race'));
            command(game, seat, payload);
            await this.state.storage.put('race', game.checkpoint());
            for (const peer of this.state.getWebSockets()) peer.send(view(game, this.state.getTags(peer)[0]));
        });
    }
}
export default { fetch(request, env) { return env.MATCH.getByName('comparison').fetch(request); } };
`);
    bundle = await rolldown({ input: source, platform: 'neutral' });
    const generated = await bundle.generate({ format: 'esm', codeSplitting: false });
    worker = new Miniflare(convertV4MiniflareOptions({
        name: 'turdtris-runtime-comparison', rootPath: directory, modulesRoot: directory,
        modules: [{ type: 'ESModule', path: join(directory, 'bundled.mjs'), contents: generated.output[0].code }],
        compatibilityDate: '2026-10-01', host: '127.0.0.1', port: 0, telemetry: { enabled: false },
        durableObjects: { MATCH: { className: 'Race', useSQLite: true } },
        durableObjectsPersist: join(directory, 'worker-state')
    }));
    return (await worker.ready).href.replace('http:', 'ws:');
}

async function dedicatedHost() {
    db = new DatabaseSync(join(directory, 'host.db'));
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE matches (id TEXT PRIMARY KEY, state TEXT NOT NULL)');
    const read = db.prepare('SELECT state FROM matches WHERE id = ?');
    const write = db.prepare('INSERT OR REPLACE INTO matches VALUES (?, ?)');
    server = new WebSocketServer({ host: '127.0.0.1', port: 0, perMessageDeflate: false });
    const peers = new Map();
    server.on('connection', (socket, request) => {
        const seat = request.url.slice(1);
        peers.set(socket, seat);
        const saved = read.get(id);
        const game = saved ? TurdtrisMatch.restore(JSON.parse(saved.state)) : new TurdtrisMatch(id, Date.now(), null, seed);
        if (!saved) write.run(id, JSON.stringify(game.checkpoint()));
        socket.send(view(game, seat));
        socket.on('message', payload => {
            const current = TurdtrisMatch.restore(JSON.parse(read.get(id).state));
            command(current, seat, payload.toString());
            write.run(id, JSON.stringify(current.checkpoint()));
            for (const [peer, position] of peers) if (peer.readyState === WebSocket.OPEN) peer.send(view(current, position));
        });
        socket.once('close', () => peers.delete(socket));
    });
    await once(server, 'listening');
    return 'ws://127.0.0.1:' + server.address().port + '/';
}

async function sample(name, url) {
    const lengths = [], players = [], durations = [];
    const sockets = seats.map(seat => new WebSocket(url + seat));
    try {
        for (const socket of sockets) {
            const state = { latest: null, receive: null, awaitFrame: null };
            state.awaitFrame = new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(Error(name + ' initial snapshot timed out')), 3000);
                state.receive = () => { clearTimeout(timer); resolve(); };
                socket.once('error', error => { clearTimeout(timer); reject(error); });
            });
            socket.on('message', data => {
                lengths.push(data.length);
                state.latest = JSON.parse(data.toString());
                state.receive?.();
            });
            players.push(state);
        }
        await Promise.all(players.map(player => player.awaitFrame));
        assert.equal(new Set(players.map(player => player.latest.seed)).size, 1);
        assert.equal(new Set(players.map(player => player.latest.startsAt)).size, 1);
        await wait(Math.max(0, players[0].latest.startsAt - Date.now()) + 30);
        lengths.length = 0;
        const begun = performance.now();
        for (let sequence = 1; sequence <= 36; sequence++) {
            const started = performance.now();
            const waits = players.map((player, index) => new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(Error(name + ' acknowledgement timed out')), 3000);
                player.receive = () => {
                    if (index === 2 ? player.latest.revision !== sequence * 2 : player.latest.self?.sequence !== sequence) return;
                    clearTimeout(timer);
                    resolve();
                };
            }));
            for (const [index, socket] of sockets.slice(0, 2).entries()) {
                const direction = (sequence + index) % 2 ? 'left' : 'right';
                const inputs = sequence === 1 ? [direction, 'drop'] : [direction];
                socket.send(JSON.stringify({ version: 1, id, action: 'input', sequence, inputs }));
            }
            await Promise.all(waits);
            durations.push(performance.now() - started);
            await wait(90);
        }
        const wallMs = performance.now() - begun;
        assert.equal(lengths.length, 216);
        assert.ok(players.every(player => player.latest.boards.a.score > 0 && player.latest.boards.b.score > 0));
        durations.sort((a, b) => a - b);
        return {
            backend: name, pairs: durations.length, persistedBatches: 72, deliveryFrames: lengths.length,
            pairedMedianMs: Number(durations[18].toFixed(2)), pairedP95Ms: Number(durations[34].toFixed(2)),
            maximumMs: Number(durations.at(-1).toFixed(2)),
            applicationBytes: lengths.reduce((sum, size) => sum + size, 0),
            elapsedSeconds: Number((wallMs / 1000).toFixed(2))
        };
    } finally {
        await Promise.all(sockets.map(async socket => {
            if (socket.readyState === WebSocket.CLOSED) return;
            const closed = once(socket, 'close');
            socket.terminate();
            await closed;
        }));
    }
}

try {
    const edge = await sample('Isolated local workerd Durable Object', await isolatedWorker());
    const dedicated = await sample('Local dedicated Node WebSocket host with SQLite', await dedicatedHost());
    console.log(JSON.stringify({ scope: 'loopback match transport with durable commits and two players plus one spectator', edge, dedicated }, null, 2));
} finally {
    if (server) await new Promise(resolve => server.close(resolve));
    db?.close();
    await worker?.dispose();
    await bundle?.close();
    await rm(directory, { recursive: true, force: true });
}
