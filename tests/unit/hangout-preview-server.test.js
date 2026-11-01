// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import WebSocket from 'ws';
import { startPreview } from '../../scripts/preview-hangout-server.mjs';

let preview;
const temporary = [];
const KEY = 'local-preview-key-0001';
const waitFor = async (check) => {
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) { const value = check(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 5)); }
    throw new Error('Expected preview event did not arrive');
};
async function boot(statePath) {
    if (!statePath) { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stalemate-preview-')); temporary.push(directory); statePath = path.join(directory, 'state.json'); }
    preview = await startPreview({ port: 0, statePath });
    const html = await (await fetch(preview.url)).text();
    return { csrf: html.match(/name="preview-csrf" content="([a-f0-9]+)"/)[1], statePath };
}
async function identity(profile, csrf) {
    const response = await fetch(`${preview.origin}/__preview/sessions`, { method: 'POST', headers: { Origin: preview.origin, 'Content-Type': 'application/json', 'X-Preview-CSRF': csrf }, body: JSON.stringify({ profile }) });
    expect(response.status).toBe(201);
    return response.json();
}
function wsUrl(session, endpoint) {
    const id = session.url.match(/\/session\/([a-f0-9]{48})/)[1];
    return `${preview.origin.replace(/^http/, 'ws')}/__preview/relay/${id}/${endpoint}?preview=${KEY}`;
}
async function connect(session, endpoint, nick) {
    const ws = new WebSocket(wsUrl(session, endpoint), { headers: { Origin: preview.origin } });
    const frames = [];
    ws.on('message', (data) => frames.push(JSON.parse(String(data))));
    ws.on('error', () => {});
    await waitFor(() => frames.find((frame) => frame.t === 'hello'));
    ws.send(JSON.stringify({ t: 'hello', nick, age13: true }));
    const welcome = await waitFor(() => frames.find((frame) => frame.t === 'welcome'));
    return { ws, frames, welcome, command: (name, args = [], ch = '#stalemate') => ws.send(JSON.stringify({ t: 'cmd', name, args, ch })) };
}
function rejectedSocket(url, origin) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url, { headers: { Origin: origin } });
        ws.on('unexpected-response', (_, response) => { response.resume(); ws.terminate(); resolve(response.statusCode); });
        ws.on('open', () => { ws.terminate(); reject(new Error('Unexpected authorized socket')); });
        ws.on('error', () => {});
    });
}
afterEach(async () => { if (preview) await preview.close(); preview = null; for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

describe('explicit private local preview', () => {
    it('binds loopback and refuses alternate hosts, cross-origin control, and filesystem paths', async () => {
        const { csrf } = await boot();
        expect(preview.address.address).toBe('127.0.0.1');
        const wrongHost = await new Promise((resolve, reject) => {
            http.get(preview.url, { headers: { Host: 'attacker.example' } }, (response) => { response.resume(); resolve(response.statusCode); }).on('error', reject);
        });
        expect(wrongHost).toBe(403);
        for (const headers of [
            { Origin: 'https://attacker.example', 'X-Preview-CSRF': csrf },
            { Origin: preview.origin, 'X-Preview-CSRF': 'wrong' },
            { 'X-Preview-CSRF': csrf }
        ]) {
            const response = await fetch(`${preview.origin}/__preview/sessions`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{"profile":"administrator"}' });
            expect(response.status).toBe(403);
            expect(response.headers.get('access-control-allow-origin')).toBeNull();
        }
        expect((await fetch(`${preview.origin}/.git/config`)).status).toBe(404);
        expect((await fetch(`${preview.origin}/scripts/preview-hangout-server.mjs`)).status).toBe(404);
        const session = await identity('guest', csrf);
        const prefix = session.url.split('/r/')[0];
        expect((await fetch(`${preview.origin}${prefix}/.git/config`)).status).toBe(404);
        expect((await fetch(`${preview.origin}${prefix}/assets/%2e%2e%2fscripts/preview-hangout-server.mjs`)).status).toBe(400);
    });

    it('grants only the explicitly selected role and sends the real capability greeting once', async () => {
        const { csrf } = await boot();
        const guest = await identity('guest', csrf);
        expect(await rejectedSocket(`${wsUrl(guest, 'lobby-admin')}&devadmin=local-dev-admin-key-0001&as=owner`, preview.origin)).toBe(403);
        expect(await rejectedSocket(`${wsUrl(guest, 'lobby-owner')}&devowner=local-dev-admin-key-0001`, preview.origin)).toBe(403);
        expect(await rejectedSocket(wsUrl(guest, 'lobby'), 'https://attacker.example')).toBe(403);
        const visitor = await connect(guest, 'lobby', 'LocalGuest');
        expect(visitor.welcome).toMatchObject({ role: 'fan', verified: false, capabilities: { moderate: false, configure: false, register: false } });
        expect(visitor.frames.filter((frame) => frame.t === 'hello')).toHaveLength(1);
        const owner = await connect(await identity('room-owner-a', csrf), 'lobby-owner', 'LocalOwner');
        expect(owner.welcome).toMatchObject({ role: 'fan', verified: true, capabilities: { moderate: false, configure: false, register: true } });
        const moderator = await connect(await identity('moderator', csrf), 'lobby-admin', 'LocalHelper');
        expect(moderator.welcome).toMatchObject({ role: 'moderator', capabilities: { moderate: true, configure: false } });
        const administrator = await connect(await identity('administrator', csrf), 'lobby-admin', 'LocalAdmin');
        expect(administrator.welcome).toMatchObject({ role: 'owner', capabilities: { moderate: true, configure: true } });
        const state = await waitFor(() => moderator.frames.find((frame) => frame.t === 'admin'));
        expect(state.state.aiModeration).toMatchObject({ enabled: false, state: 'disabled' });
        expect([...preview.lobby._debug.conns.values()].filter((connection) => connection.nick)).toHaveLength(4);
    });

    it('cold-restores a registered room and the same account on a different device without chat backlog', async () => {
        const { csrf, statePath } = await boot();
        const ownerIdentity = await identity('room-owner-a', csrf);
        const owner = await connect(ownerIdentity, 'lobby-owner', 'FirstOwner');
        owner.command('join', ['#local-restart']);
        await waitFor(() => preview.lobby._debug.channels.has('#local-restart'));
        owner.command('register', [], '#local-restart');
        const account = await waitFor(() => preview.lobby._debug.channels.get('#local-restart').owner);
        owner.command('topic', ['A room that returns'], '#local-restart');
        await waitFor(() => preview.lobby._debug.channels.get('#local-restart').topic === 'A room that returns');
        owner.ws.send(JSON.stringify({ t: 'say', ch: '#local-restart', text: 'Words that should disappear' }));
        await waitFor(() => owner.frames.find((frame) => frame.t === 'line' && frame.text === 'Words that should disappear'));
        expect(fs.readFileSync(statePath, 'utf8')).not.toContain('Words that should disappear');
        const firstDevice = owner.frames.find((frame) => frame.t === 'device').token;
        await preview.close(); preview = null;
        const again = await boot(statePath);
        const returning = await connect(await identity('room-owner-a', again.csrf), 'lobby-owner', 'ReturningOwner');
        expect(returning.frames.find((frame) => frame.t === 'device').token).not.toBe(firstDevice);
        returning.command('join', ['#local-restart']);
        const joined = await waitFor(() => returning.frames.find((frame) => frame.t === 'join' && frame.ch.name === '#local-restart'));
        expect(joined.ch).toMatchObject({ persistent: true, topic: 'A room that returns' });
        expect(joined.ch.names.find((member) => member.nick === 'ReturningOwner')).toMatchObject({ owner: true, prefix: '@' });
        expect(preview.lobby._debug.channels.get('#local-restart').owner).toBe(account);
        expect(returning.frames.some((frame) => frame.t === 'line' && frame.text === 'Words that should disappear')).toBe(false);
        // Existing seven-day launcher links remain valid after a server restart.
        expect((await fetch(`${preview.origin}${ownerIdentity.url}`)).status).toBe(200);
        expect(fs.statSync(statePath).mode & 0o777).toBe(0o600);
    });

    it('does not expose local auth switches in product files or use the stateless test server', async () => {
        const { csrf } = await boot();
        const session = await identity('room-owner-a', csrf);
        const page = await fetch(`${preview.origin}${session.url}`);
        const html = await page.text();
        expect(html).toContain('data-profile="room-owner-a"');
        expect(html).toContain('/__preview/assets/session.js');
        expect(html).not.toContain('data-goatcounter');
        expect(html).not.toContain('https://challenges.cloudflare.com');
        expect(page.headers.get('content-security-policy')).toContain("connect-src 'self'");
        expect(page.headers.get('content-security-policy')).not.toContain('workers.dev');
        expect((await fetch(`${preview.origin}/__hangout-relay/__test/modlog.json`)).status).toBe(404);
        expect((await fetch(`${preview.origin}/__preview/status`)).headers.get('x-robots-tag')).toContain('noindex');
    });
});


describe('owned local preview shutdown', () => {
    it('closes an owned incomplete control request without waiting for its remaining body or creating an identity', async () => {
        const createServer = http.createServer;
        let nativeServer, request, ownedSocket, observedBody, closing, completed = false, closeFailure;
        let serverClosed = false;
        const responses = [];
        const observing = vi.spyOn(http, 'createServer').mockImplementation(function (...args) {
            const server = Reflect.apply(createServer, this, args);
            nativeServer = server;
            server.once('close', () => { serverClosed = true; });
            server.on('request', incoming => {
                if (incoming.method === 'POST' && incoming.url === '/__preview/sessions') {
                    incoming.on('data', chunk => {
                        // Passive observation of the actual IncomingMessage:
                        // do not consume/end it or replace the server handler.
                        observedBody = { method: incoming.method, path: incoming.url, complete: incoming.complete, bytes: chunk.length };
                    });
                }
            });
            return server;
        });
        try {
            const { csrf, statePath } = await boot();
            const sessionsBefore = JSON.parse(fs.readFileSync(statePath, 'utf8')).sessions;
            const body = '{"profile":"guest"}';
            request = http.request(new URL('/__preview/sessions', preview.origin), {
                method: 'POST', agent: false,
                headers: { Origin: preview.origin, 'Content-Type': 'application/json', 'X-Preview-CSRF': csrf,
                    'Content-Length': Buffer.byteLength(body) }
            });
            request.on('socket', socket => { ownedSocket = socket; });
            request.on('error', () => {}); // Shutdown can legitimately abort this owned request.
            request.on('response', response => { responses.push(response.statusCode); response.resume(); });
            request.flushHeaders();
            request.write(body.slice(0, 5)); // Deliberately never call end() before close().
            await waitFor(() => observedBody && ownedSocket);
            expect(observedBody).toEqual({ method: 'POST', path: '/__preview/sessions', complete: false, bytes: 5 });
            expect(ownedSocket.destroyed).toBe(false);
            expect(JSON.parse(fs.readFileSync(statePath, 'utf8')).sessions).toEqual(sessionsBefore);

            closing = preview.close();
            closing.then(() => { completed = true; }, error => { closeFailure = error; completed = true; });
            // Existing bounded event wait and default case deadline stay unchanged.
            // A listener close alone is not completed cleanup while this body is held.
            await waitFor(() => completed);
            expect(closeFailure).toBeUndefined();
            expect(serverClosed).toBe(true);
            expect(nativeServer.listening).toBe(false);
            await waitFor(() => ownedSocket.destroyed);
            expect(responses).not.toContain(201);
            expect(JSON.parse(fs.readFileSync(statePath, 'utf8')).sessions).toEqual(sessionsBefore);
        } finally {
            // Release ONLY this test's request/socket on the old failing source;
            // never kill processes, close foreign connections or change a timeout.
            request?.destroy();
            ownedSocket?.destroy();
            if (closing) { await closing.catch(() => {}); preview = null; }
            observing.mockRestore();
        }
    });
});


describe('local preview shutdown races on owned resources', () => {
    function observeNativeServer() {
        const original = http.createServer;
        const observation = { server: null, closeEvents: 0, partialBody: null, rawSocket: null, rawBytes: 0, upgrades: 0 };
        const spy = vi.spyOn(http, 'createServer').mockImplementation(function (...args) {
            const server = Reflect.apply(original, this, args); observation.server = server;
            server.on('close', () => observation.closeEvents += 1);
            server.on('request', incoming => {
                if (incoming.method === 'POST' && incoming.url === '/__preview/sessions') incoming.on('data', data => {
                    if (!incoming.complete && data.length === 5) observation.partialBody = { complete: incoming.complete, bytes: data.length };
                });
            });
            server.on('connection', socket => socket.on('data', data => {
                if (data.toString().startsWith('GET /__preview/relay/')) { observation.rawSocket = socket; observation.rawBytes += data.length; }
            }));
            server.on('upgrade', () => observation.upgrades += 1);
            return server;
        });
        return { observation, restore: () => spy.mockRestore() };
    }

    it('deduplicates concurrent close while retiring a real guest and refusing the remainder of an unfinished identity request', async () => {
        const native = observeNativeServer();
        let request, ownedSocket, completion, completed = false, failure;
        const responses = [];
        try {
            const { csrf, statePath } = await boot();
            const guest = await connect(await identity('guest', csrf), 'lobby', 'ClosingGuest');
            expect(guest.ws.readyState).toBe(WebSocket.OPEN);
            expect(preview.lobby._debug.conns.size).toBe(1);
            const sessionsBefore = JSON.parse(fs.readFileSync(statePath, 'utf8')).sessions;
            const body = '{"profile":"room-owner-b"}';
            request = http.request(new URL('/__preview/sessions', preview.origin), {
                method: 'POST', agent: false, headers: { Origin: preview.origin, 'Content-Type': 'application/json',
                    'X-Preview-CSRF': csrf, 'Content-Length': Buffer.byteLength(body) }
            });
            request.on('socket', socket => { ownedSocket = socket; });
            request.on('error', () => {});
            request.on('response', response => { responses.push(response.statusCode); response.resume(); });
            request.flushHeaders(); request.write(body.slice(0, 5));
            await waitFor(() => native.observation.partialBody && ownedSocket);
            expect(native.observation.partialBody).toEqual({ complete: false, bytes: 5 });
            expect(ownedSocket.destroyed).toBe(false);
            completion = Promise.all([preview.close(), preview.close()]);
            completion.then(() => { completed = true; }, error => { failure = error; completed = true; });
            request.end(body.slice(5)); // A late complete body must not create a new profile.
            await waitFor(() => completed);
            expect(failure).toBeUndefined();
            expect(native.observation.closeEvents).toBe(1);
            await waitFor(() => guest.ws.readyState === WebSocket.CLOSED && ownedSocket.destroyed);
            expect(preview.lobby._debug.conns.size).toBe(0);
            expect(responses).not.toContain(201);
            expect(JSON.parse(fs.readFileSync(statePath, 'utf8')).sessions).toEqual(sessionsBefore);
            await preview.close(); // Settled repeat is also safe.
        } finally {
            request?.destroy(); ownedSocket?.destroy();
            if (completion) { await completion.catch(() => {}); preview = null; }
            native.restore();
        }
    });

    it('retires its own native pre-upgrade TCP socket without requiring the peer to finish the HTTP headers', async () => {
        const native = observeNativeServer();
        let socket, closing, completed = false, failure;
        try {
            const { csrf, statePath } = await boot(), session = await identity('guest', csrf);
            const sessionsBefore = JSON.parse(fs.readFileSync(statePath, 'utf8')).sessions;
            const target = new URL(wsUrl(session, 'lobby'));
            socket = net.connect(preview.address.port, '127.0.0.1');
            socket.on('error', () => {});
            await waitFor(() => socket.readyState === 'open');
            socket.write('GET ' + target.pathname + target.search + ' HTTP/1.1\r\nHost: ' + new URL(preview.origin).host
                + '\r\nOrigin: ' + preview.origin + '\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: '
                + Buffer.alloc(16, 1).toString('base64') + '\r\nSec-WebSocket-Version: 13\r\n');
            // No terminating blank line: actual TCP data arrived, but native HTTP
            // has not emitted upgrade and no WebSocket client exists to terminate.
            await waitFor(() => native.observation.rawSocket && native.observation.rawBytes > 0);
            expect(native.observation.rawSocket.remotePort).toBe(socket.localPort);
            expect(native.observation.upgrades).toBe(0);
            expect(socket.destroyed).toBe(false);
            expect(preview.lobby._debug.conns.size).toBe(0);
            closing = preview.close();
            closing.then(() => { completed = true; }, error => { failure = error; completed = true; });
            await waitFor(() => completed);
            expect(failure).toBeUndefined();
            await waitFor(() => socket.destroyed && native.observation.rawSocket.destroyed);
            expect(native.observation.closeEvents).toBe(1);
            expect(native.observation.upgrades).toBe(0);
            expect(JSON.parse(fs.readFileSync(statePath, 'utf8')).sessions).toEqual(sessionsBefore);
        } finally {
            socket?.destroy();
            if (closing) { await closing.catch(() => {}); preview = null; }
            native.restore();
        }
    });
});
