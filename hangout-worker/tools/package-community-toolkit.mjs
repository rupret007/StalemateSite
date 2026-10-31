// Export committed public entry tooling, never the application or private files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--community-address' || args[2] !== '--out')
    throw new Error('Usage: node hangout-worker/tools/package-community-toolkit.mjs --community-address https://approved.example/ --out NEW_DIRECTORY');
const raw = args[1];
let address;
try { address = new URL(raw); } catch { throw new Error('Expected an approved HTTPS community address.'); }
if (raw.length > 2048 || raw !== raw.trim() || address.protocol !== 'https:' || address.username || address.password
    || raw.includes('?') || raw.includes('#') || address.hostname.includes('*') || !address.pathname.endsWith('/'))
    throw new Error('Use an HTTPS community address ending in /, without credentials, queries or fragments.');
const communityAddress = address.href;
const output = path.resolve(args[3]);
const parent = fs.realpathSync(path.dirname(output));
const destination = path.join(parent, path.basename(output));
for (const root of ['r', 'assets', 'join', '.beta-assets', '.pilot-assets', '.pages-assets']) {
    const relative = path.relative(path.join(fs.realpathSync(repo), root), destination);
    if (relative === '' || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
        throw new Error('Keep the operator toolkit outside published application asset directories.');
}
const git = (...argv) => execFileSync('git', argv, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 });
const sourceCommit = git('rev-parse', 'HEAD').toString('ascii').trim();
if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sourceCommit)) throw new Error('Expected a full committed source revision.');
function committedFile(name, optional = false) {
    const entry = git('ls-tree', '-z', sourceCommit, '--', name).toString('utf8').replace(/\0$/, '');
    if (!entry && optional) return null;
    const match = /^(100644|100755) blob [a-f0-9]+\t(.+)$/.exec(entry);
    if (!match || match[2] !== name) throw new Error('A required public source file is missing or is not a regular committed file.');
    return git('show', `${sourceCommit}:${name}`);
}
const sources = new Map();
for (const name of ['scripts/package-community-entry.mjs', 'hangout-worker/src/community-integration.mjs',
    'r/45662413410ed051/entry-sites.mjs', 'hangout-internal/community-integration.example.json']) sources.set(name, committedFile(name));
const exporterName = 'hangout-worker/tools/package-community-toolkit.mjs', exporterBytes = committedFile(exporterName);
function committedCheckout(actual, expected) {
    let offset = 0;
    for (let i = 0; i < expected.length; i++) {
        // Accept Windows checkout CRLF for committed bare LF, without decoding
        // or otherwise normalizing source bytes. Exported files stay exact Git blobs.
        if (expected[i] === 10 && (i === 0 || expected[i - 1] !== 13) && actual[offset] === 13 && actual[offset + 1] === 10) offset++;
        if (actual[offset++] !== expected[i]) return false;
    }
    return offset === actual.length;
}
// Executed modules must match this commit before importing the shared validator.
// Other working changes are left untouched; copied bytes always come from Git.
for (const name of [exporterName, 'scripts/package-community-entry.mjs',
    'hangout-worker/src/community-integration.mjs', 'r/45662413410ed051/entry-sites.mjs']) {
    let current = repo;
    for (const part of name.split('/').slice(0, -1)) {
        current = path.join(current, part);
        const stat = fs.lstatSync(current);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Commit regular public toolkit source before exporting.');
    }
    const file = path.join(repo, name), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || !committedCheckout(fs.readFileSync(file), name === exporterName ? exporterBytes : sources.get(name)))
        throw new Error('Commit public toolkit executable changes before exporting.');
}
const licenseNames = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'COPYING.md', 'COPYING.txt', 'NOTICE', 'NOTICE.md', 'NOTICE.txt'];
const licenseFiles = [];
for (const name of licenseNames) { const bytes = committedFile(name, true); if (bytes) { sources.set(name, bytes); licenseFiles.push(name); } }
if (sources.get('hangout-internal/community-integration.example.json').length > 32768)
    throw new Error('Public registration example is too large.');
const template = JSON.parse(sources.get('hangout-internal/community-integration.example.json').toString('utf8'));
template.communityAddress = communityAddress;
if (!Array.isArray(template.sites)) throw new Error('Expected the public registration example.');
for (const site of template.sites) { site.enabled = false; site.domainVerified = false; }
const { communityIntegration } = await import('../src/community-integration.mjs');
communityIntegration(template);
function relocated(name, from, to) {
    const bytes = sources.get(name), text = bytes.toString('utf8');
    if (!Buffer.from(text).equals(bytes) || text.split(from).length !== 2)
        throw new Error('Expected the reviewed UTF-8 module import before toolkit relocation.');
    return Buffer.from(text.replace(from, to));
}
const files = new Map([
    ['scripts/package-community-entry.mjs', relocated('scripts/package-community-entry.mjs',
        "'../hangout-worker/src/community-integration.mjs'", "'../lib/community-integration.mjs'")],
    ['lib/community-integration.mjs', relocated('hangout-worker/src/community-integration.mjs',
        "'../../r/45662413410ed051/entry-sites.mjs'", "'./entry-sites.mjs'")],
    ['lib/entry-sites.mjs', sources.get('r/45662413410ed051/entry-sites.mjs')],
    ...licenseFiles.map(name => [name, sources.get(name)])
]);
files.set('community-integration.example.json', Buffer.from(JSON.stringify(template, null, 2) + '\n'));
const escape = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
files.set('neutral-link.html', Buffer.from(`<a href="${escape(communityAddress)}" referrerpolicy="no-referrer">Hang Out</a>\n<small>Opens our shared community.</small>\n`));
files.set('README.md', Buffer.from(`# Shared Hang Out entry toolkit\n\nCopy neutral-link.html into any existing website. It opens the one approved\ncommunity address without a site account, registration, badge or staff power.\nNormal invitation/sign-in rules still apply. No credentials belong in links.\n\nOptional registered badges and return links:\n1. Review community-integration.example.json and verify each domain separately.\n   Every example starts disabled and unverified; this tool verifies no domain.\n2. With Node.js 22 or newer, run:\n   node scripts/package-community-entry.mjs --config reviewed.json --out NEW_DIRECTORY\n3. The community operator must separately configure approved extra badge sites\n   in HANGOUT_ENTRY_SITES. The link builder makes no server changes. Disabling\n   an integration stops approved-link generation; ordinary links remain valid.\n\nSOURCE-MANIFEST.json binds this toolkit to committed source and hashes every\npayload file. Only two fixed module imports are relocated for standalone use;\nsource-input hashes and delivered-file hashes are recorded separately.\nThe toolkit does not contain the full app or prove the deployed version.\nNo cookie copying, cross-site SSO, provider activation or deployment is performed.\nPreserve existing site pages and use a new output directory.\n`));
files.set('LICENSE-NOTICE.txt', Buffer.from(`This export does not add or change any license or permission.\nRecognized repository-root license/notice files included: ${licenseFiles.join(', ') || 'none'}.\nReview the current project permissions before public code redistribution.\nNo third-party media, fonts, binaries or node_modules are included.\n`));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inputNames = new Map([
    ['scripts/package-community-entry.mjs', 'entry-link-builder'], ['hangout-worker/src/community-integration.mjs', 'integration-contract'],
    ['r/45662413410ed051/entry-sites.mjs', 'entry-registry'], ['hangout-internal/community-integration.example.json', 'registration-example']
]);
const manifest = { version: 1, kind: 'community-entry-toolkit', moduleLayout: 'standalone-imports-v1', sourceCommit, communityAddress, licenseFiles,
    exporter: { path: exporterName, bytes: exporterBytes.length, sha256: sha(exporterBytes) },
    sourceFiles: [...sources].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, bytes]) => ({ name: inputNames.get(name) || name, bytes: bytes.length, sha256: sha(bytes) })),
    files: [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, bytes]) => ({ path: name, bytes: bytes.length, sha256: sha(bytes) })) };
const created = [], directories = new Map();
const same = (filename, identity, directory) => {
    try { const s = fs.lstatSync(filename); return (directory ? s.isDirectory() : s.isFile()) && s.dev === identity.dev && s.ino === identity.ino; }
    catch { return false; }
};
function directory(name) {
    if (directories.has(name)) {
        if (!same(name, directories.get(name), true)) throw new Error('Toolkit output directory changed during creation.');
        return;
    }
    if (name !== destination) directory(path.dirname(name));
    fs.mkdirSync(name);
    const { dev, ino } = fs.lstatSync(name), identity = { dev, ino };
    directories.set(name, identity); created.push({ name, ...identity, directory: true });
}
function write(name, bytes) {
    const filename = path.join(destination, name); directory(path.dirname(filename));
    const fd = fs.openSync(filename, 'wx', 0o644);
    try { const { dev, ino } = fs.fstatSync(fd); created.push({ name: filename, dev, ino, directory: false }); fs.writeFileSync(fd, bytes); }
    finally { fs.closeSync(fd); }
}
try {
    directory(destination);
    for (const [name, bytes] of files) write(name, bytes);
    // Written last: a partial export must not look like a complete toolkit.
    write('SOURCE-MANIFEST.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
} catch (error) {
    for (const item of created.reverse()) {
        if (!same(item.name, item, item.directory)) continue;
        if (![...directories].every(([name, identity]) => !item.name.startsWith(name + path.sep) || same(name, identity, true))) continue;
        try { if (item.directory) fs.rmdirSync(item.name); else fs.unlinkSync(item.name); } catch { /* Preserve foreign/replaced files. */ }
    }
    throw error;
}
console.log('Prepared a committed-source community entry toolkit; no site or server configuration changed.');
