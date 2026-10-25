import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { communityIntegration, communityJoinLink, communityLinkHtml, communityPublicManifest } from '../../hangout-worker/src/community-integration.mjs';
import { createEntrySiteRegistry, entryReturn } from '../../r/45662413410ed051/entry-sites.mjs';

const config = () => ({ version: 1, communityAddress: 'https://community.example.test/beta/', sites: [
    { id: 'stalemate', label: 'Stalemate', origins: ['https://stalemate.band'], returnUrl: 'https://stalemate.band/', permissions: ['link', 'badge', 'return'], enabled: true, domainVerified: true },
    { id: 'rad-dad', label: 'Rad Dad', origins: ['https://raddadband.com'], returnUrl: 'https://raddadband.com/', permissions: ['link', 'badge', 'return'], enabled: true, domainVerified: true },
    { id: 'makers', label: 'Makers & Friends', origins: ['https://makers.example.test'], permissions: ['link', 'badge'], enabled: true, domainVerified: true }
] });

describe('public community integration contract', () => {
    it('gives two band sites and a reviewed third site the same community address, only varying display source', () => {
        const integration = communityIntegration(config());
        const links = integration.sites.map((site) => communityJoinLink(integration, site.id));
        expect(new Set(links.map((link) => new URL(link.href).origin))).toEqual(new Set(['https://community.example.test']));
        expect(links.map((link) => new URL(link.href).searchParams.get('via'))).toEqual(['stalemate', 'rad-dad', 'makers']);
        expect(links[2].returnUrl).toBe('');
        expect(communityLinkHtml(integration, 'makers')).toContain('Makers &amp; Friends');
        expect(communityPublicManifest(integration).entrySites).toEqual([{ id: 'makers', label: 'Makers & Friends' }]);
        expect(Object.isFrozen(integration.entrySites)).toBe(true);
    });

    it('revokes integration links and custom badges without changing the canonical community or other sites', () => {
        const value = config(); value.sites[2].enabled = false;
        const integration = communityIntegration(value);
        expect(() => communityJoinLink(integration, 'makers')).toThrow('not enabled');
        expect(integration.entrySites.makers).toBeUndefined();
        expect(communityJoinLink(integration, 'stalemate').href).toContain('via=stalemate');
        expect(integration.communityAddress).toBe(value.communityAddress);
    });

    it('supports a plain link without a source badge or return permission', () => {
        const value = config(); value.sites[2].permissions = ['link'];
        const integration = communityIntegration(value);
        expect(communityJoinLink(integration, 'makers')).toMatchObject({ href: value.communityAddress, source: '', returnUrl: '' });
        expect(integration.entrySites.makers).toBeUndefined();
    });

    it('carries an approved custom return URL through the manifest into the real runtime registry', () => {
        const value = config();
        value.sites[2].permissions.push('return'); value.sites[2].returnUrl = 'https://makers.example.test/community/';
        const integration = communityIntegration(value);
        const registry = createEntrySiteRegistry(communityPublicManifest(integration).entrySites);
        expect(entryReturn('makers', registry)).toMatchObject({ href: value.sites[2].returnUrl });
        expect(communityJoinLink(integration, 'makers').href).toContain('via=makers');
    });

    it.each([
        (c) => { c.communityAddress = 'https://secret@community.example.test/'; },
        (c) => { c.communityAddress = 'https://community.example.test/?invite=private'; },
        (c) => { c.communityAddress = 'javascript:alert(1)'; },
        (c) => { c.communityAddress = 'http://community.example.test/'; },
        (c) => { c.sites[0].origins = ['https://*.stalemate.band']; },
        (c) => { c.sites[0].origins = ['https://stalemate.band/private']; },
        (c) => { c.sites[0].returnUrl = 'https://attacker.example/'; },
        (c) => { c.sites[0].domainVerified = false; },
        (c) => { c.sites[0].permissions.push('moderate'); },
        (c) => { c.sites[2].permissions = ['link', 'return']; c.sites[2].returnUrl = 'https://makers.example.test/'; },
        (c) => { c.sites[0].returnUrl = 'https://stalemate.band/unsupported-return/'; },
        (c) => { c.sites[0].origins = ['https://different.example']; c.sites[0].returnUrl = 'https://different.example/'; },
        (c) => { c.sites[2].id = ['makers']; },
        (c) => { c.sites[1].id = ['makers']; c.sites[2].id = ['makers']; },
        (c) => { c.sites[0].accessToken = 'accidental-private-value'; },
        (c) => { c.sites[2].label = '<img src=x>'; },
        (c) => { c.sites[2].id = 'stalemate'; },
        (c) => { c.sites[0].label = 'Verified administrator'; },
        (c) => { c.version = 2; }
    ])('rejects unsafe URLs, spoofed identity, authority, unverified configuration and accidental secrets', (mutate) => {
        const value = config(); mutate(value);
        expect(() => communityIntegration(value)).toThrow();
    });

    it('permits explicit loopback fixtures without weakening the production HTTPS default', () => {
        const value = config(); value.communityAddress = 'http://127.0.0.1:4321/r/45662413410ed051/lobby/';
        expect(() => communityIntegration(value)).toThrow();
        expect(communityIntegration(value, { allowLoopback: true }).communityAddress).toBe(value.communityAddress);
        value.communityAddress = 'http://lan-machine.test/';
        expect(() => communityIntegration(value, { allowLoopback: true })).toThrow();
    });

    it('packages only reviewed public snippets and a manifest into a new directory, never overwriting another artifact', () => {
        const temporary = mkdtempSync(path.join(tmpdir(), 'community-package-'));
        try {
            const input = path.join(temporary, 'reviewed.json'); const output = path.join(temporary, 'package');
            writeFileSync(input, JSON.stringify(config()));
            const script = path.resolve('scripts/package-community-entry.mjs');
            execFileSync(process.execPath, [script, '--config', input, '--out', output]);
            expect(readdirSync(output).sort()).toEqual(['README.txt', 'makers.html', 'manifest.json', 'rad-dad.html', 'stalemate.html']);
            expect(readFileSync(path.join(output, 'stalemate.html'), 'utf8')).toContain('https://community.example.test/beta/?via=stalemate');
            expect(() => execFileSync(process.execPath, [script, '--config', input, '--out', output], { stdio: 'pipe' })).toThrow();
            expect(readFileSync(path.join(output, 'manifest.json'), 'utf8')).not.toMatch(/private|token|cookie/i);
            const disabled = config(); disabled.sites.forEach((site) => { site.enabled = false; });
            writeFileSync(input, JSON.stringify(disabled));
            expect(() => execFileSync(process.execPath, [script, '--config', input, '--out', path.join(temporary, 'disabled')], { stdio: 'pipe' })).toThrow();
            expect(readdirSync(temporary)).not.toContain('disabled');
        } finally { rmSync(temporary, { recursive: true, force: true }); }
    });
    it('removes its own partial package when a later output write fails', () => {
        const temporary = mkdtempSync(path.join(tmpdir(), 'community-package-failure-'));
        try {
            const input = path.join(temporary, 'reviewed.json'); const output = path.join(temporary, 'package');
            const hook = path.join(temporary, 'write-failure.cjs');
            writeFileSync(input, JSON.stringify(config()));
            // Inject an actual child-process filesystem failure after the first
            // snippet, exercising cleanup without changing production code.
            writeFileSync(hook, "const fs = require('node:fs'); const original = fs.writeFileSync; let writes = 0; fs.writeFileSync = function(file, ...args) { if (typeof file === 'number' && ++writes === 2) throw Error('synthetic output failure'); return original.call(this, file, ...args); };\n");
            expect(() => execFileSync(process.execPath, ['--require', hook, path.resolve('scripts/package-community-entry.mjs'), '--config', input, '--out', output], { stdio: 'pipe' })).toThrow();
            expect(readdirSync(temporary).sort()).toEqual(['reviewed.json', 'write-failure.cjs']);
        } finally { rmSync(temporary, { recursive: true, force: true }); }
    });
});
