import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const exporter = 'scripts/package-community-toolkit.mjs';
const sourceNames = [exporter, 'scripts/package-community-entry.mjs', 'hangout-worker/src/community-integration.mjs',
    'r/45662413410ed051/entry-sites.mjs', 'hangout-internal/community-integration.example.json'];
const temporary = [], address = 'https://community.example.test/beta/';
const sha = value => createHash('sha256').update(value).digest('hex');
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function workspace() {
    const top = fs.mkdtempSync(path.join(os.tmpdir(), 'hangout-entry-toolkit-')); temporary.push(top);
    const repo = path.join(top, 'source'); fs.mkdirSync(repo);
    for (const name of sourceNames) {
        fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
        fs.copyFileSync(path.join(root, name), path.join(repo, name));
    }
    // Deliberately committed private fixtures must never enter the allowlisted export.
    fs.mkdirSync(path.join(repo, '.local')); fs.writeFileSync(path.join(repo, '.local/private.txt'), 'PRIVATE_FIXTURE_NEVER_EXPORT');
    fs.writeFileSync(path.join(repo, '.env'), 'TEST_ONLY_SECRET=PRIVATE_FIXTURE_NEVER_EXPORT');
    fs.writeFileSync(path.join(repo, 'README.md'), 'PRIVATE_FIXTURE_NEVER_EXPORT');
    const rawGit = (...args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
    const git = (...args) => rawGit(...args).toString().trim();
    git('init', '-q'); git('config', 'user.name', 'Toolkit fixture'); git('config', 'user.email', 'fixture@example.test');
    git('config', 'commit.gpgsign', 'false'); git('config', 'core.hooksPath', path.join(repo, '.git/unused-hooks'));
    const commit = () => { git('add', '.'); git('commit', '-qm', 'Public toolkit fixture'); return git('rev-parse', 'HEAD'); };
    const head = commit();
    return { top, repo, git, rawGit, commit, head, out: path.join(top, 'toolkit') };
}
function run(fixture, url = address, out = fixture.out) {
    return spawnSync(process.execPath, [path.join(fixture.repo, exporter), '--community-address', url, '--out', out],
        { cwd: fixture.top, encoding: 'utf8', timeout: 10000 });
}
function allFiles(dir, prefix = '') {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => {
        const name = prefix + item.name;
        return item.isDirectory() ? allFiles(path.join(dir, item.name), name + '/') : [name];
    }).sort();
}

describe('committed-source community entry toolkit', () => {
    it('exports only the finite public graph, committed source and complete hashes', () => {
        const f = workspace();
        // Dirty non-executable material is not silently included or modified.
        fs.writeFileSync(path.join(f.repo, 'hangout-internal/community-integration.example.json'), 'DIRTY_TEMPLATE_NEVER_EXPORT');
        const r = run(f); expect(r.status, r.stderr).toBe(0);
        const manifest = JSON.parse(fs.readFileSync(path.join(f.out, 'SOURCE-MANIFEST.json')));
        expect(manifest).toMatchObject({ version: 1, kind: 'community-entry-toolkit', sourceCommit: f.head, communityAddress: address, licenseFiles: [] });
        expect(allFiles(f.out)).toEqual(['LICENSE-NOTICE.txt', 'README.md', 'SOURCE-MANIFEST.json', 'community-integration.example.json',
            'hangout-worker/src/community-integration.mjs', 'neutral-link.html', 'r/45662413410ed051/entry-sites.mjs', 'scripts/package-community-entry.mjs']);
        for (const file of manifest.files) {
            const bytes = fs.readFileSync(path.join(f.out, file.path)); expect(sha(bytes)).toBe(file.sha256); expect(bytes.length).toBe(file.bytes);
        }
        for (const file of manifest.sourceFiles) expect(sha(f.rawGit('show', `${f.head}:${file.path}`))).toBe(file.sha256);
        expect(manifest.exporter.sha256).toBe(sha(fs.readFileSync(path.join(f.repo, exporter))));
        const example = JSON.parse(fs.readFileSync(path.join(f.out, 'community-integration.example.json')));
        expect(example.communityAddress).toBe(address); expect(example.sites.every(site => !site.enabled && !site.domainVerified)).toBe(true);
        const contents = allFiles(f.out).map(name => fs.readFileSync(path.join(f.out, name), 'utf8')).join('\n');
        expect(contents).not.toContain('PRIVATE_FIXTURE_NEVER_EXPORT'); expect(contents).not.toContain('DIRTY_TEMPLATE_NEVER_EXPORT');
        expect(contents).not.toContain(f.top); expect(fs.readFileSync(path.join(f.repo, 'hangout-internal/community-integration.example.json'), 'utf8')).toBe('DIRTY_TEMPLATE_NEVER_EXPORT');
    });

    it('runs the extracted link builder after the original checkout is removed, without dependencies', () => {
        const f = workspace(); expect(run(f).status).toBe(0); fs.rmSync(f.repo, { recursive: true });
        const config = { version: 1, communityAddress: address, sites: [
            // Explicit CLI fixture, not a claim of actual domain verification.
            { id: 'fixture', label: 'Fixture', origins: ['https://fixture.example.test'], permissions: ['link'], enabled: true, domainVerified: true }
        ] };
        const input = path.join(f.top, 'reviewed-fixture.json'); fs.writeFileSync(input, JSON.stringify(config));
        const generated = path.join(f.top, 'generated');
        const r = spawnSync(process.execPath, [path.join(f.out, 'scripts/package-community-entry.mjs'), '--config', input, '--out', generated],
            { cwd: f.top, encoding: 'utf8', timeout: 10000 });
        expect(r.status, r.stderr).toBe(0);
        expect(fs.readFileSync(path.join(generated, 'fixture.html'), 'utf8')).toContain(`href="${address}" referrerpolicy="no-referrer"`);
        expect(JSON.parse(fs.readFileSync(path.join(generated, 'manifest.json'))).entrySites).toEqual([]);
        expect(fs.existsSync(path.join(f.out, 'node_modules'))).toBe(false);
    });

    it('accepts CRLF checkouts but still exports exact committed bytes and reproducible metadata', () => {
        const f = workspace(); expect(run(f).status).toBe(0);
        const originalManifest = fs.readFileSync(path.join(f.out, 'SOURCE-MANIFEST.json'));
        for (const name of sourceNames.filter(name => name.endsWith('.mjs'))) {
            const filename = path.join(f.repo, name);
            fs.writeFileSync(filename, fs.readFileSync(filename, 'utf8').replace(/\r?\n/g, '\r\n'));
        }
        const second = path.join(f.top, 'crlf-toolkit'), r = run(f, address, second); expect(r.status, r.stderr).toBe(0);
        expect(fs.readFileSync(path.join(second, 'SOURCE-MANIFEST.json'))).toEqual(originalManifest);
        for (const file of JSON.parse(originalManifest).files)
            expect(fs.readFileSync(path.join(second, file.path))).toEqual(fs.readFileSync(path.join(f.out, file.path)));
    });

    it.each([
        ['insecure', 'http://community.example.test/'], ['credentials', 'https://user:PRIVATE_URL_FIXTURE@community.example.test/'],
        ['query', 'https://community.example.test/?invite=PRIVATE_URL_FIXTURE'], ['fragment', 'https://community.example.test/#PRIVATE_URL_FIXTURE'],
        ['wildcard', 'https://*.example.test/'], ['missing slash', 'https://community.example.test/beta'], ['surrounding space', ' https://community.example.test/']
    ])('rejects %s before writing and never echoes a credential-like URL', (_label, url) => {
        const f = workspace(), r = run(f, url); expect(r.status).not.toBe(0);
        expect(fs.existsSync(f.out)).toBe(false); expect(r.stderr).not.toContain('PRIVATE_URL_FIXTURE');
    });

    it('refuses existing output and published asset paths without changing either', () => {
        const f = workspace(); fs.mkdirSync(f.out); fs.writeFileSync(path.join(f.out, 'foreign.txt'), 'leave this file');
        expect(run(f).status).not.toBe(0); expect(allFiles(f.out)).toEqual(['foreign.txt']);
        expect(fs.readFileSync(path.join(f.out, 'foreign.txt'), 'utf8')).toBe('leave this file');
        const published = path.join(f.repo, 'r', 'accidental-toolkit');
        expect(run(f, address, published).status).not.toBe(0); expect(fs.existsSync(published)).toBe(false);
    });

    it('refuses missing, symlinked and uncommitted executable source without producing a partial toolkit', () => {
        const f = workspace(), module = path.join(f.repo, 'r/45662413410ed051/entry-sites.mjs');
        const original = fs.readFileSync(module); fs.appendFileSync(module, '\n// uncommitted fixture\n');
        expect(run(f).status).not.toBe(0); expect(fs.existsSync(f.out)).toBe(false);
        fs.writeFileSync(module, original); fs.unlinkSync(module); fs.symlinkSync('../../../.env', module); f.commit();
        expect(run(f).status).not.toBe(0); expect(fs.existsSync(f.out)).toBe(false);
        fs.unlinkSync(module); f.commit();
        expect(run(f).status).not.toBe(0); expect(fs.existsSync(f.out)).toBe(false);
    });

    it('rejects private registration fields through the shared production validator', () => {
        const f = workspace(), name = path.join(f.repo, 'hangout-internal/community-integration.example.json');
        const config = JSON.parse(fs.readFileSync(name)); config.sites[0].apiToken = 'PRIVATE_CONFIG_FIXTURE';
        fs.writeFileSync(name, JSON.stringify(config)); f.commit(); const r = run(f);
        expect(r.status).not.toBe(0); expect(fs.existsSync(f.out)).toBe(false); expect(r.stderr).not.toContain('PRIVATE_CONFIG_FIXTURE');
    });

    it('retains actual project license bytes without inventing a grant', () => {
        const f = workspace(), bytes = 'Fixture project terms; no substitute license.\n';
        fs.writeFileSync(path.join(f.repo, 'LICENSE'), bytes); f.commit(); expect(run(f).status).toBe(0);
        expect(fs.readFileSync(path.join(f.out, 'LICENSE'), 'utf8')).toBe(bytes);
        expect(JSON.parse(fs.readFileSync(path.join(f.out, 'SOURCE-MANIFEST.json'))).licenseFiles).toEqual(['LICENSE']);
        expect(fs.readFileSync(path.join(f.out, 'LICENSE-NOTICE.txt'), 'utf8')).toContain('does not add or change any license');
    });
});
