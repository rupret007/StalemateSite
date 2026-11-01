// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
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
        expect(owner.frames.some((frame) => frame.t === 'device')).toBe(true);
        await preview.close(); preview = null;
        const again = await boot(statePath);
        const returning = await connect(await identity('room-owner-a', again.csrf), 'lobby-owner', 'ReturningOwner');
        expect(returning.frames.some((frame) => frame.t === 'device')).toBe(true);
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
