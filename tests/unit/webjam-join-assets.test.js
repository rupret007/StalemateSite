// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { JSDOM } from 'jsdom';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname, join } from 'node:path';

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


it('ships the reviewed Chess receiver only in the protected beta package', () => {
    const repo = resolve(root, '..');
    const overlay = join(repo, 'hangout-worker/web-join-chess');
    const pin = JSON.parse(readFileSync(join(overlay, 'PROVENANCE.json')));
    expect(pin.repository).toBe(provenance.repository);
    expect(pin.license).toBe(provenance.license);
    expect(pin.commit).toMatch(/^[a-f0-9]{40}$/);
    const overlayFiles = ['game-offer.js', 'index.html', 'session.js'];
    expect(Object.keys(pin.files).sort()).toEqual(overlayFiles);
    expect(readdirSync(overlay).sort()).toEqual([...overlayFiles, 'PROVENANCE.json'].sort());
    for (const file of overlayFiles) {
        const bytes = readFileSync(join(overlay, file));
        expect(createHash('sha256').update(bytes).digest('hex'), file).toBe(pin.files[file].sha256);
    }

    expect(read('session.js')).not.toContain('./game-offer.js');
    expect(read('index.html')).not.toContain('id="game-offer"');
    expect(existsSync(join(root, 'game-offer.js'))).toBe(false);
    expect(readFileSync(join(overlay, 'session.js'), 'utf8')).toContain('from "./game-offer.js"');
    expect(readFileSync(join(overlay, 'index.html'), 'utf8')).toContain('id="game-offer" hidden');
});

it('copies the full protected receiver into the beta build', async () => {
    const repo = resolve(root, '..');
    const build = mkdtempSync(join(tmpdir(), 'webjam-beta-assets-'));
    try {
        for (const path of ['scripts/package-pilot.cjs', 'r', 'assets', 'join', 'play', 'hangout-worker/arcade/VENDORED.txt', 'hangout-worker/web-join-chess']) {
            cpSync(join(repo, path), join(build, path), { recursive: true });
        }
        const result = spawnSync(process.execPath, [join(build, 'scripts/package-pilot.cjs'), 'beta'], { encoding: 'utf8' });
        expect(result.status, result.stderr).toBe(0);
        for (const file of ['index.html', 'session.js', 'game-offer.js']) {
            expect(readFileSync(join(build, '.beta-assets/join', file)))
                .toEqual(readFileSync(join(repo, 'hangout-worker/web-join-chess', file)));
        }
        const path = join(build, '.beta-assets/join/game-offer.js');
        const { bindGameOfferChannel, GAME_OFFER_LABEL } = await import(pathToFileURL(path).href);
        const { window } = new JSDOM('<div hidden></div>');
        try {
            const root = window.document.querySelector('div');
            const channel = new window.EventTarget();
            channel.label = GAME_OFFER_LABEL;
            expect(bindGameOfferChannel(channel, { root, authorized: () => true })).toBe(true);
            channel.dispatchEvent(new window.MessageEvent('message', {
                data: JSON.stringify({ game: 'chess', hostName: 'Band host', state: 'full' })
            }));
            expect(root.hidden).toBe(false);
            expect(root.querySelector('p').textContent)
                .toBe('This table is full. Stay in this room and ask your host for a new invite when a seat opens.');
            const dismiss = root.querySelector('button');
            expect(dismiss.textContent).toBe('Dismiss');
            dismiss.click();
            expect(root.hidden).toBe(true);
            expect(root.textContent).toBe('');
        } finally {
            window.close();
        }
    } finally {
        rmSync(build, { recursive: true, force: true });
    }
});
