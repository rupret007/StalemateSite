// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = fileURLToPath(new URL('../../join/', import.meta.url));
const provenance = JSON.parse(readFileSync(resolve(root, 'PROVENANCE.json')));
const read = (name) => readFileSync(resolve(root, name), 'utf8');

describe('pinned WebJam browser assets', () => {
    it('ships the licensed, hash-bound runtime without development files or dependencies', () => {
        expect(provenance.repository).toBe('https://github.com/rupret007/webjam');
        expect(provenance.commit).toMatch(/^[a-f0-9]{40}$/);
        expect(provenance.license).toBe('MIT');
        expect(read('LICENSE')).toContain('Copyright (c) 2024 WebJam Contributors');
        expect(readdirSync(root).sort()).toEqual([...Object.keys(provenance.files), 'PROVENANCE.json'].sort());
        for (const [name, record] of Object.entries(provenance.files)) {
            const hash = createHash('sha256').update(readFileSync(resolve(root, name))).digest('hex');
            expect(hash, name).toBe(record.shippedSha256);
            if (name !== 'index.html') expect(hash, name).toBe(record.upstreamSha256);
        }
    });

    it('resolves the entire static module and stylesheet graph within the packaged client', () => {
        const html = read('index.html');
        const assets = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)].map(match => match[1]);
        expect(assets.sort()).toEqual(['app.js', 'style.css']);
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
