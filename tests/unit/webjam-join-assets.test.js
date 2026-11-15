// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = fileURLToPath(new URL('../../join/', import.meta.url));
const provenance = JSON.parse(readFileSync(resolve(root, 'PROVENANCE.json')));
const read = (name) => readFileSync(resolve(root, name), 'utf8');
const handoffAssets = ['handoff.html', 'handoff.js'];

describe('pinned WebJam browser assets', () => {
    it('ships the licensed, hash-bound runtime without development files or dependencies', () => {
        expect(provenance.repository).toBe('https://github.com/rupret007/webjam');
        expect(provenance.commit).toMatch(/^[a-f0-9]{40}$/);
        expect(provenance.license).toBe('MIT');
        expect(read('LICENSE')).toContain('Copyright (c) 2024 WebJam Contributors');
        expect(readdirSync(root).sort()).toEqual([
            ...Object.keys(provenance.files), 'PROVENANCE.json', ...handoffAssets,
        ].sort());
        for (const [name, record] of Object.entries(provenance.files)) {
            const hash = createHash('sha256').update(readFileSync(resolve(root, name))).digest('hex');
            expect(hash, name).toBe(record.shippedSha256);
            if (Object.hasOwn(provenance.modifications, name)) {
                expect(provenance.modifications[name], name).toBeTruthy();
                expect(hash, name).not.toBe(record.upstreamSha256);
            } else expect(hash, name).toBe(record.upstreamSha256);
        }
    });

    it('keeps the site-owned return page local and separate from the pinned runtime', () => {
        const html = read('handoff.html');
        const assets = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)].map(match => match[1]);
        expect(assets.sort()).toEqual(['handoff.js', 'style.css']);
        expect(html).toContain('content="noindex, nofollow, noarchive, nosnippet"');
        expect(html).toContain('name="referrer" content="no-referrer"');
        expect(html).toContain("default-src 'none'; script-src 'self'; style-src 'self'");
        expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/i);
        expect(read('handoff.js')).not.toMatch(/\bimport\b/);
    });

    it('distinguishes an unconfirmed return from an explicit invite refusal', () => {
        const status = { textContent: '' };
        const timers = new Map();
        let channel;
        const createPage = () => {
            status.textContent = '';
            timers.clear();
            runInNewContext(read('handoff.js'), {
                location: {
                    hash: '#' + 'a'.repeat(32) + '&k=' + 'A'.repeat(43) + '&s=' + '0'.repeat(64) + '&g=1&e=1',
                    protocol: 'https:', pathname: '/join/handoff.html', origin: 'https://fixture.invalid',
                },
                history: { replaceState() {} },
                document: { getElementById: () => status },
                BroadcastChannel: class {
                    constructor() { channel = this; }
                    postMessage() {}
                    close() { this.closed = true; }
                },
                setTimeout(callback, delay) { timers.set(delay, callback); return delay; },
                clearTimeout(delay) { timers.delete(delay); },
            });
        };
        createPage();
        timers.get(8000)();
        expect(status.textContent).toContain('Still waiting');
        expect(channel.closed).toBeUndefined();
        channel.onmessage({ data: { returned: true } });
        expect(status.textContent).toBe('Return to your Jam room. You can close this tab.');
        expect(channel.closed).toBe(true);
        expect(timers.size).toBe(0);
        createPage();
        timers.get(8000)();
        timers.get(90000)();
        expect(status.textContent).toContain('Check with your bandmate before sending another invite.');
        expect(channel.closed).toBe(true);
        expect(channel.onmessage).toBeNull();
        expect(timers.size).toBe(0);
        createPage();
        channel.onmessage({ data: { returned: false } });
        expect(status.textContent).toBe('End the browser invite in WebJam, then retry from your Jam room in this browser profile.');
        expect(channel.closed).toBe(true);
        expect(timers.size).toBe(0);
    });

    it('resolves the entire static module and stylesheet graph within the packaged client', () => {
        const html = read('index.html');
        expect(html).toContain('<meta name="webjam-video" content="disabled">');
        const assets = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)].map(match => match[1]);
        expect(assets.sort()).toEqual(['join-entry.js', 'style.css']);
        for (const name of Object.keys(provenance.files).filter(name => name.endsWith('.js'))) {
            for (const match of read(name).matchAll(/\bimport\s[^;]*?\bfrom\s+["']([^"']+)["']/g)) {
                expect(match[1], name).toMatch(/^\.\/[a-z-]+\.js$/);
                const target = resolve(dirname(resolve(root, name)), match[1]);
                expect(target.startsWith(root), name).toBe(true);
                expect(existsSync(target), `${name}: ${match[1]}`).toBe(true);
            }
        }
    });

    it('keeps the page unindexed and free of analytics, inline code and third-party scripts', () => {
        const html = read('index.html');
        expect(html).toContain('content="noindex, nofollow, noarchive, nosnippet"');
        expect(html).toContain("default-src 'none'; script-src 'self'; style-src 'self'");
        expect(html).not.toMatch(/goatcounter|google-analytics|<script(?![^>]*\bsrc=)/i);
        expect(read('_headers')).toContain('Permissions-Policy: camera=(), geolocation=(), microphone=(self)');
        expect(read('config.js')).toContain('https://webjam-turn-credentials.jeffstory007.workers.dev');
    });
});
