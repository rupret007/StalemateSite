// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const monitor = require('../../scripts/beta-health-monitor.cjs');
const installer = require('../../scripts/install-beta-monitor.cjs');
const KEY = 'fixture-ops-key-never-print-'.repeat(2);
const directories = [];
function directory() { const name = fs.mkdtempSync(path.join(os.tmpdir(), 'stalemate-monitor-')); directories.push(name); return name; }
function fixture() {
    return { version: 1, checkedAt: new Date().toISOString(), storageCheck: 'read-only', providerChecks: 'not-performed',
        service: { state: 'ready', reasons: [] }, admission: { state: 'open', lock: 'off', shield: false, lockAuto: false },
        storage: { lobby: 'ok', registry: 'ok', quota: 'ok' }, features: { email: { configured: true, provider: 'not-probed' }, moderationContact: { configured: true },
            ai: { enabled: false, configured: true, state: 'disabled' }, turn: { enabled: false, configured: false, providerUsage: 'unknown' } },
        usage: [{ name: 'connections', used: 7, limit: 100, unit: 'connections', scope: 'application', period: 'day' }] };
}
function config(home = directory()) { const file = path.join(home, 'beta-monitor.json'); fs.writeFileSync(file, JSON.stringify({ version: 1, opsKey: KEY }), { mode: 0o600 }); return file; }
const response = (body = fixture(), status = 200) => Response.json(body, { status });
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); vi.useRealTimers(); });

describe('private configuration and portable manual use', () => {
    it('accepts only a valid private regular config, without echoing its key in errors', () => {
        const file = config(); expect(monitor.readConfig(file)).toEqual({ opsKey: KEY });
        fs.chmodSync(file, 0o644);
        expect(() => monitor.readConfig(file, { platform: 'darwin' })).toThrow('config-file-not-private');
        expect(monitor.readConfig(file, { platform: 'win32' })).toEqual({ opsKey: KEY }); // Windows uses ACLs.
        fs.chmodSync(file, 0o600); fs.writeFileSync(file, '{"version":1,"opsKey":"short"}');
        expect(() => monitor.readConfig(file)).toThrow('config-key-invalid');
        const link = path.join(path.dirname(file), 'link.json'); fs.symlinkSync(file, link);
        expect(() => monitor.readConfig(link)).toThrow('config-file-invalid');
    });
    it('uses standard local config locations and never accepts a custom origin', () => {
        expect(monitor.defaultConfigPath({ platform: 'darwin', home: '/users/test' })).toBe('/users/test/Library/Application Support/Stalemate/beta-monitor.json');
        expect(monitor.defaultConfigPath({ platform: 'linux', home: '/users/test', env: {} })).toBe('/users/test/.config/stalemate/beta-monitor.json');
        expect(monitor.defaultConfigPath({ platform: 'win32', home: '/users/test', env: { APPDATA: '/roaming' } })).toBe('/roaming/Stalemate/beta-monitor.json');
        expect(() => monitor.cliArgs(['once', '--origin', 'https://other.example'])).toThrow('unknown-option');
    });
    it('does no state writes or notifications in dry-run, and never creates a guest', async () => {
        const file = config(), fetchImpl = vi.fn(async () => response()), notify = vi.fn();
        const result = await monitor.runOnce({ configPath: file, dryRun: true, fetchImpl, notify });
        expect(result).toMatchObject({ kind: 'healthy', dryRun: true, notification: 'not-requested' });
        expect(fs.existsSync(monitor.pathsForConfig(file).directory)).toBe(false); expect(notify).not.toHaveBeenCalled();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, options] = fetchImpl.mock.calls[0];
        expect(url).toBe(monitor.ORIGIN + '/beta/health'); expect(options).toMatchObject({ method: 'GET', redirect: 'error', headers: { Authorization: 'Bearer ' + KEY } });
        expect(options.headers.Cookie).toBeUndefined(); expect(url).not.toContain(KEY); expect(JSON.stringify(result)).not.toContain(KEY);
    });
});

describe('bounded truthful health probing', () => {
    it.each([
        [401, { error: 'unauthorized' }, 'authentication-error'],
        [403, '<html>Cloudflare edge rejection</html>', 'access-blocked'],
        [503, { error: 'ops-not-configured' }, 'endpoint-configuration-error'],
        [502, 'private arbitrary provider error', 'service-error']
    ])('distinguishes HTTP %s without reflecting response text', async (status, body, kind) => {
        const result = await monitor.probeHealth({ opsKey: KEY, fetchImpl: async () => typeof body === 'string' ? new Response(body, { status }) : response(body, status) });
        expect(result).toMatchObject({ kind, httpStatus: status }); expect(JSON.stringify(result)).not.toMatch(/arbitrary|Cloudflare edge rejection/);
    });
    it('distinguishes authorized storage failure from expected setup degradation', async () => {
        const failed = fixture(); failed.service = { state: 'unavailable', reasons: ['storage-unavailable'] }; failed.storage.quota = 'unavailable';
        const result = await monitor.probeHealth({ opsKey: KEY, fetchImpl: async () => response(failed, 503) });
        expect(result).toMatchObject({ kind: 'service-error', httpStatus: 503, storageCheck: 'read-only', providerChecks: 'not-performed' });
        const paused = fixture(); paused.service = { state: 'degraded', reasons: ['contact-unconfigured'] }; paused.features.moderationContact.configured = false;
        const setup = await monitor.probeHealth({ opsKey: KEY, fetchImpl: async () => response(paused) });
        expect(setup).toMatchObject({ kind: 'degraded', httpStatus: 200 }); expect(setup.issues).toContain('moderation-contact-unconfigured');
    });
    it('accepts actual fractional lobby request costs while keeping event counters integral', async () => {
        const body = fixture(); body.usage.push({ name: 'lobbyRequests', used: 17.05, limit: 40000, unit: 'requests', scope: 'application', period: 'day' });
        const result = await monitor.probeHealth({ opsKey: KEY, fetchImpl: async () => response(body) });
        expect(result.kind).toBe('healthy'); expect(result.usage[1].used).toBe(17.05);
        body.usage[0].used = 7.05;
        expect((await monitor.probeHealth({ opsKey: KEY, fetchImpl: async () => response(body) })).kind).toBe('response-contract-error');
    });
    it('rejects malformed contracts and oversized/invalid response bodies', async () => {
        const invalid = fixture(); invalid.usage[0].name = 'private@example.test';
        for (const fetchImpl of [async () => response(invalid), async () => new Response('{broken'), async () => new Response('x'.repeat(32769))]) {
            expect((await monitor.probeHealth({ opsKey: KEY, fetchImpl })).kind).toBe('response-contract-error');
        }
        expect(() => monitor.validateHealth({ ...fixture(), providerChecks: 'successful' })).toThrow();
        expect(() => monitor.validateHealth({ ...fixture(), usage: [...fixture().usage, ...fixture().usage] })).toThrow();
    });
    it('rejects grossly stale or future health timestamps and warns on unconfigured staff safely', async () => {
        for (const offset of [-601000, 601000]) {
            const body = fixture(); body.checkedAt = new Date(Date.now() + offset).toISOString();
            expect((await monitor.probeHealth({ opsKey: KEY, fetchImpl: async () => response(body) })).kind).toBe('response-contract-error');
        }
        const body = fixture(); body.features.staffAuth = { configured: false };
        const result = await monitor.probeHealth({ opsKey: KEY, fetchImpl: async () => response(body) });
        expect(result).toMatchObject({ kind: 'degraded', issues: ['staff-auth-unconfigured'] });
    });
    it('bounds both stalled connection and stalled body reads and cancels their signal', async () => {
        let signal, cancelled = false;
        expect((await monitor.probeHealth({ opsKey: KEY, timeoutMs: 10, fetchImpl: async (_, options) => { signal = options.signal; return new Promise(() => {}); } })).kind).toBe('network-error');
        expect(signal.aborted).toBe(true);
        const result = await monitor.probeHealth({ opsKey: KEY, timeoutMs: 10, fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })) });
        expect(result.kind).toBe('network-error'); expect(cancelled).toBe(true);
    });
    it('uses only fixed issue codes and known app allowances in notifications', async () => {
        const body = fixture(); body.service = { state: 'degraded', reasons: ['private-room-name'] }; body.secret = KEY; body.privateEmail = 'someone@example.test';
        body.usage[0].used = 80;
        const result = await monitor.probeHealth({ opsKey: KEY, fetchImpl: async () => response(body) });
        const alert = monitor.notification(result);
        expect(alert.message).toContain('Connection allowance 80%'); expect(alert.message).toContain('not a provider bill');
        expect(JSON.stringify({ result, alert })).not.toMatch(/private-room-name|someone@example|fixture-ops-key/);
        expect(monitor.USAGE_NAMES.betaSessions).toBe('Session registry allowance');
    });
});

describe('transition alerts, quota warning thresholds and private state', () => {
    it('alerts once on failure, deduplicates repeats, then alerts on recovery', async () => {
        const file = config(), notify = vi.fn(async () => ({ delivery: 'submitted-to-os' })); let failed = false;
        const options = { configPath: file, notify, fetchImpl: async () => failed ? new Response('', { status: 502 }) : response() };
        expect((await monitor.runOnce(options)).notification).toBe('not-needed'); // first healthy probe is quiet
        failed = true; expect((await monitor.runOnce(options)).notification).toBe('submitted-to-os');
        expect((await monitor.runOnce(options)).notification).toBe('not-needed');
        failed = false; expect((await monitor.runOnce(options)).notification).toBe('submitted-to-os');
        expect(notify).toHaveBeenCalledTimes(2); expect(notify.mock.calls[1][0].title).toContain('recovered');
        const paths = monitor.pathsForConfig(file);
        expect(fs.statSync(paths.directory).mode & 0o777).toBe(0o700);
        for (const stored of [paths.state, paths.log]) { expect(fs.statSync(stored).mode & 0o777).toBe(0o600); expect(fs.readFileSync(stored, 'utf8')).not.toContain(KEY); }
    });
    it('warns at 80%, deduplicates percentage changes, escalates at cap and recovers below threshold', async () => {
        const file = config(), body = fixture(), notify = vi.fn(async () => ({ delivery: 'submitted-to-os' }));
        const options = { configPath: file, notify, fetchImpl: async () => response(body) };
        for (const used of [79, 80, 95, 100, 110, 79]) { body.usage[0].used = used; await monitor.runOnce(options); }
        expect(notify).toHaveBeenCalledTimes(3);
        expect(notify.mock.calls[0][0].message).toContain('80%'); expect(notify.mock.calls[1][0].message).toContain('cap reached');
        expect(notify.mock.calls[2][0].title).toContain('recovered');
    });
    it('alerts on evidence write degradation during an existing Access setup warning', async () => {
        const file = config(), body = fixture(), notify = vi.fn(async () => ({ delivery: 'submitted-to-os' }));
        body.service = { state: 'degraded', reasons: ['identity-unconfigured', 'staff-unconfigured'] };
        body.features.email.configured = false; body.features.staffAuth = { configured: false };
        const options = { configPath: file, notify, fetchImpl: async () => response(body) };
        await monitor.runOnce(options);
        body.service.reasons.push('storage-degraded');
        expect((await monitor.runOnce(options)).issues).toContain('storage-degraded');
        expect(notify).toHaveBeenCalledTimes(2);
        await monitor.runOnce(options); expect(notify).toHaveBeenCalledTimes(2);
        body.service.reasons.pop(); await monitor.runOnce(options); expect(notify).toHaveBeenCalledTimes(3);
    });
    it('alerts on actual 85% readonly to 95% closed restriction and lost usage visibility, never arbitrary reasons', async () => {
        const file = config(), body = fixture(), notify = vi.fn(async () => ({ delivery: 'submitted-to-os' }));
        body.service = { state: 'degraded', reasons: ['lobby-budget-readonly'] };
        body.usage = [{ name: 'lobbyRequests', used: 34000, limit: 40000, unit: 'requests', scope: 'application', period: 'day' }];
        const options = { configPath: file, notify, fetchImpl: async () => response(body) };
        await monitor.runOnce(options);
        body.service.reasons = ['lobby-budget-closed']; body.usage[0].used = 38000;
        expect((await monitor.runOnce(options)).issues).toContain('lobby-budget-closed'); expect(notify).toHaveBeenCalledTimes(2);
        body.service.reasons.push('private-room-name');
        expect((await monitor.runOnce(options)).issues).not.toContain('private-room-name'); expect(notify).toHaveBeenCalledTimes(2);
        body.service.reasons.push('usage-unknown');
        expect((await monitor.runOnce(options)).issues).toContain('usage-unknown'); expect(notify).toHaveBeenCalledTimes(3);
        expect(JSON.stringify(notify.mock.calls)).not.toContain('private-room-name');
    });
    it('alerts on observed AI review failure, deduplicates it and reports recovery during another restriction', async () => {
        const file = config(), body = fixture(), notify = vi.fn(async () => ({ delivery: 'submitted-to-os' }));
        body.service = { state: 'degraded', reasons: ['identity-unconfigured'] };
        body.features.email.configured = false;
        body.features.ai = { enabled: true, configured: true, state: 'ready' };
        const options = { configPath: file, notify, fetchImpl: async () => response(body) };
        await monitor.runOnce(options);
        body.features.ai.state = 'degraded'; body.service.reasons.push('ai-unavailable');
        expect((await monitor.runOnce(options)).issues).toContain('ai-unavailable');
        expect(notify).toHaveBeenCalledTimes(2);
        await monitor.runOnce(options); expect(notify).toHaveBeenCalledTimes(2);
        body.features.ai.state = 'ready'; body.service.reasons.pop();
        expect((await monitor.runOnce(options)).issues).not.toContain('ai-unavailable');
        expect(notify).toHaveBeenCalledTimes(3);
    });
    it('retries failed notification delivery without claiming it succeeded', async () => {
        const file = config(), notify = vi.fn().mockRejectedValueOnce(new Error(KEY)).mockResolvedValue({ delivery: 'submitted-to-os' });
        const options = { configPath: file, notify, fetchImpl: async () => new Response('', { status: 401 }) };
        expect((await monitor.runOnce(options)).notification).toBe('failed');
        expect((await monitor.runOnce(options)).notification).toBe('submitted-to-os');
        expect((await monitor.runOnce(options)).notification).toBe('not-needed'); expect(notify).toHaveBeenCalledTimes(2);
        expect(fs.readFileSync(monitor.pathsForConfig(file).log, 'utf8')).not.toContain(KEY);
    });
    it('reports local configuration failure once without making network calls', async () => {
        const file = path.join(directory(), 'missing.json'), fetchImpl = vi.fn(), notify = vi.fn(async () => ({ delivery: 'submitted-to-os' }));
        expect((await monitor.runOnce({ configPath: file, fetchImpl, notify })).kind).toBe('local-configuration-error');
        await monitor.runOnce({ configPath: file, fetchImpl, notify }); expect(fetchImpl).not.toHaveBeenCalled(); expect(notify).toHaveBeenCalledTimes(1);
    });
    it('bounds logs and rejects dangling symlinks for state/log writes', () => {
        const dir = directory(), log = path.join(dir, 'monitor.log'); fs.writeFileSync(log, 'a'.repeat(1024 * 1024), { mode: 0o600 });
        monitor.appendLog(log, { kind: 'healthy' }); expect(fs.statSync(log).size).toBeLessThan(100); expect(fs.statSync(log + '.previous').size).toBe(1024 * 1024);
        const link = path.join(dir, 'dangling'); fs.symlinkSync(path.join(dir, 'nonexistent'), link);
        expect(() => monitor.writePrivate(link, 'x')).toThrow('state-file-invalid'); expect(() => monitor.appendLog(link, {})).toThrow('state-file-invalid');
    });
    it('uses a fixed AppleScript and separate literal notification argv without a shell', async () => {
        const alert = { title: '$(touch bad) "hello"', message: '`touch bad` \\ slash & punctuation' }, execImpl = vi.fn((file, args, options, callback) => callback(null));
        expect(await monitor.desktopNotify(alert, { platform: 'darwin', execImpl })).toEqual({ delivery: 'submitted-to-os' });
        expect(execImpl).toHaveBeenCalledWith('/usr/bin/osascript', ['-e', monitor.NOTIFICATION_SCRIPT, alert.title, alert.message], expect.objectContaining({ timeout: 10000 }), expect.any(Function));
        expect(await monitor.desktopNotify(alert, { platform: 'linux', execImpl })).toEqual({ delivery: 'console-only' }); expect(execImpl).toHaveBeenCalledTimes(1);
    });
});

describe('reversible user LaunchAgent installation, without installing in tests', () => {
    function plan(home = directory()) { return installer.createPlan({ home, configPath: config(home), nodePath: process.execPath, platform: 'darwin', uid: 501 }); }
    it('produces a private five-minute GUI job with config path only and XML-escaped paths', () => {
        const p = plan(), plist = installer.plistFor({ ...p, configPath: '/private/A & B/"config".json' });
        expect(p.runtime).toContain('beta-monitor/monitor.cjs'); expect(p.runtime).not.toContain('/Documents/');
        expect(plist).toContain('<integer>300</integer>'); expect(plist).toContain('<key>Umask</key><integer>63</integer>');
        expect(plist).toContain('A &amp; B/&quot;config&quot;.json'); expect(plist).toContain('<string>Aqua</string>');
        expect(plist).not.toContain(KEY); expect(plist).not.toContain('EnvironmentVariables'); expect(plist).not.toContain('/bin/sh');
        expect(installer.stableNode(process.execPath)).not.toContain('/Cellar/'); expect(fs.existsSync(p.plist)).toBe(false); // plan is read-only
        expect(() => installer.createPlan({ platform: 'linux', uid: 501 })).toThrow('macos-user-session-required');
        expect(() => installer.createPlan({ platform: 'darwin', uid: 0 })).toThrow('macos-user-session-required');
    });
    it('copies runtime outside Documents and uses only structured launchctl calls, then uninstalls reversibly', () => {
        const p = plan(); let loaded = false;
        const spawnImpl = vi.fn((file, args) => {
            expect(file).toBe('/bin/launchctl');
            if (args[0] === 'print') return { status: loaded ? 0 : 113, stdout: loaded ? 'state = waiting\n last exit code = 0\n' : '' };
            if (args[0] === 'bootstrap') loaded = true;
            if (args[0] === 'bootout') loaded = false;
            return { status: 0, stdout: '' };
        });
        expect(installer.install(p, { spawnImpl })).toMatchObject({ installed: true, loaded: true, intervalSeconds: 300 });
        for (const file of [p.runtime, p.plist, p.stdout, p.stderr]) expect(fs.statSync(file).mode & 0o777).toBe(0o600);
        expect(fs.readFileSync(p.runtime, 'utf8')).toContain('probeHealth'); expect(fs.readFileSync(p.plist, 'utf8')).not.toContain(KEY);
        expect(spawnImpl.mock.calls).toContainEqual(['/bin/launchctl', ['bootstrap', 'gui/501', p.plist], expect.any(Object)]);
        expect(installer.uninstall(p, { spawnImpl })).toEqual({ installed: false, label: installer.LABEL, privateFilesPreserved: true });
        expect(fs.existsSync(p.plist)).toBe(false); expect(fs.existsSync(p.configPath)).toBe(true); expect(fs.existsSync(p.runtime)).toBe(true);
        expect(JSON.stringify(spawnImpl.mock.calls)).not.toContain(KEY);
    });
    it('does not unload or write files when configuration is invalid, and reports actual launch failures', () => {
        const p = plan(), spawnImpl = vi.fn(); fs.chmodSync(p.configPath, 0o644);
        expect(() => installer.install(p, { spawnImpl })).toThrow('config-file-not-private'); expect(spawnImpl).not.toHaveBeenCalled(); expect(fs.existsSync(p.runtime)).toBe(false);
        fs.chmodSync(p.configPath, 0o600);
        expect(() => installer.install(p, { spawnImpl: () => ({ status: 1, stdout: '' }) })).toThrow('launchagent-start-failed');
    });
});
