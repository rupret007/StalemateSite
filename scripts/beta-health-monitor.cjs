#!/usr/bin/env node
'use strict';

// No guest credentials or browser sessions. The sole network operation is an
// authenticated, read-only probe of this fixed private beta deployment.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');

const ORIGIN = 'https://stalemate-hangout-beta.jeffstory007.workers.dev';
const TIMEOUT_MS = 10000;
const MAX_BODY = 32768;
const MAX_LOG = 1024 * 1024;
// The session registry cap includes unexpired revoked tombstones; it is not a
// count of people currently connected to chat.
const USAGE_NAMES = Object.freeze({ connections: 'Connection allowance', lobbyRequests: 'Lobby request allowance', aiReviews: 'AI review allowance', betaSessions: 'Session registry allowance' });
const USAGE_UNITS = Object.freeze({ connections: 'connections', lobbyRequests: 'requests', aiReviews: 'reviews', betaSessions: 'sessions' });
// These failure/restriction states have no equivalent in admission/storage
// fields. Keep their transitions visible even during another setup warning.
const CRITICAL_REASONS = Object.freeze(['storage-degraded', 'lobby-budget-readonly', 'lobby-budget-closed', 'usage-unknown']);
const NOTIFICATION_SCRIPT = 'on run argv\n display notification (item 2 of argv) with title (item 1 of argv) subtitle "Private beta health"\nend run';

class MonitorConfigError extends Error { constructor(code) { super(code); this.code = code; } }
class ContractError extends Error {}
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
// Lobby request accounting includes fractional costs (for example 1/20 for a
// heartbeat); the other published allowances count whole events or sessions.
const validUsed = row => row.name === 'lobbyRequests' ? Number.isFinite(row.used) && row.used <= Number.MAX_SAFE_INTEGER : Number.isSafeInteger(row.used);

function defaultConfigPath({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
    if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Stalemate', 'beta-monitor.json');
    if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Stalemate', 'beta-monitor.json');
    return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'stalemate', 'beta-monitor.json');
}

function privateFile(file, { platform = process.platform, uid = process.getuid?.() } = {}) {
    let stat;
    try { stat = fs.lstatSync(file); } catch { throw new MonitorConfigError('config-file-unavailable'); }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new MonitorConfigError('config-file-invalid');
    // Windows ACLs, rather than POSIX mode bits, determine who can read a file.
    if (platform !== 'win32' && ((stat.mode & 0o077) || uid !== undefined && stat.uid !== uid)) throw new MonitorConfigError('config-file-not-private');
    return stat;
}

function readConfig(file, options = {}) {
    privateFile(file, options);
    let config;
    try { config = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new MonitorConfigError('config-json-invalid'); }
    if (!object(config) || config.version !== 1 || typeof config.opsKey !== 'string' || !/^\S{32,256}$/.test(config.opsKey)) throw new MonitorConfigError('config-key-invalid');
    return { opsKey: config.opsKey };
}

function pathsForConfig(file) {
    const directory = path.join(path.dirname(path.resolve(file)), 'beta-monitor');
    return { directory, state: path.join(directory, 'state.json'), log: path.join(directory, 'monitor.log') };
}

function ensurePrivateDirectory(directory) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || process.getuid && stat.uid !== process.getuid()) throw new MonitorConfigError('state-directory-invalid');
    if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
}

function safeExisting(file) {
    let stat;
    try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || process.getuid && stat.uid !== process.getuid()) throw new MonitorConfigError('state-file-invalid');
}

function readState(file) {
    safeExisting(file);
    if (!fs.existsSync(file)) return null;
    if (fs.statSync(file).size > 8192) return null;
    try {
        const state = JSON.parse(fs.readFileSync(file, 'utf8'));
        return object(state) && state.version === 1 && typeof state.ackSignature === 'string' && state.ackSignature.length <= 4096 ? state : null;
    } catch { return null; }
}

function writePrivate(file, value) {
    safeExisting(file);
    const temporary = file + '.' + process.pid + '.tmp';
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, value); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
    if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
}

function appendLog(file, entry) {
    safeExisting(file);
    if (fs.existsSync(file) && fs.statSync(file).size >= MAX_LOG) {
        safeExisting(file + '.previous');
        fs.renameSync(file, file + '.previous');
    }
    const fd = fs.openSync(file, 'a', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(entry) + '\n'); } finally { fs.closeSync(fd); }
    if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
}

async function readBounded(response, signal) {
    if (Number(response.headers.get('content-length')) > MAX_BODY || !response.body) throw new ContractError();
    const reader = response.body.getReader();
    const cancel = () => { reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    let size = 0, text = ''; const decoder = new TextDecoder();
    try {
        while (true) {
            if (signal.aborted) throw new Error('timeout');
            const part = await reader.read(); if (part.done) break;
            size += part.value.byteLength; if (size > MAX_BODY) { cancel(); throw new ContractError(); }
            text += decoder.decode(part.value, { stream: true });
        }
        try { return JSON.parse(text + decoder.decode()); } catch { throw new ContractError(); }
    } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

function validateHealth(body) {
    if (!object(body) || body.version !== 1 || typeof body.checkedAt !== 'string' || !Number.isFinite(Date.parse(body.checkedAt))
        || !object(body.service) || !['ready', 'degraded', 'unavailable'].includes(body.service.state)
        || !Array.isArray(body.service.reasons) || body.service.reasons.length > 32 || body.service.reasons.some(code => typeof code !== 'string' || !/^[a-z][a-z0-9_-]{0,79}$/.test(code))
        || body.storageCheck !== 'read-only' || body.providerChecks !== 'not-performed'
        || !object(body.admission) || !['open', 'paused', 'unconfigured'].includes(body.admission.state)
        || !['off', 'readonly', 'closed', 'unknown'].includes(body.admission.lock)
        || ![true, false, null].includes(body.admission.shield) || ![true, false, null].includes(body.admission.lockAuto)
        || !object(body.storage) || ['lobby', 'registry', 'quota'].some(key => !['ok', 'unavailable'].includes(body.storage[key]))
        || !object(body.features) || !object(body.features.email) || typeof body.features.email.configured !== 'boolean' || body.features.email.provider !== 'not-probed'
        || !object(body.features.ai) || typeof body.features.ai.enabled !== 'boolean' || typeof body.features.ai.configured !== 'boolean'
        || !['disabled', 'misconfigured', 'ready', 'capped', 'unknown'].includes(body.features.ai.state)
        || !object(body.features.turn) || typeof body.features.turn.enabled !== 'boolean' || typeof body.features.turn.configured !== 'boolean' || body.features.turn.providerUsage !== 'unknown'
        || !Array.isArray(body.usage) || body.usage.length > 4 || new Set(body.usage.map(row => row?.name)).size !== body.usage.length
        || body.usage.some(row => !object(row) || !Object.hasOwn(USAGE_NAMES, row.name) || row.unit !== USAGE_UNITS[row.name]
            || row.scope !== 'application' || !['day', 'active'].includes(row.period) || !validUsed(row) || row.used < 0 || !Number.isSafeInteger(row.limit) || row.limit < 1)) throw new ContractError();
    return body;
}

function failure(kind, at, status) { return { kind, checkedAt: new Date(at).toISOString(), httpStatus: status || null, issues: [kind], usage: [], warnings: [] }; }

function classifyHealth(body, at, httpStatus) {
    const issues = [];
    if (body.service.state !== 'ready') issues.push('service-' + body.service.state);
    for (const code of CRITICAL_REASONS) if (body.service.reasons.includes(code)) issues.push(code);
    if (body.admission.state !== 'open') issues.push('admission-' + body.admission.state);
    if (body.admission.lock !== 'off') issues.push('lobby-' + body.admission.lock);
    if (body.admission.shield) issues.push('shield-raised');
    for (const key of ['lobby', 'registry', 'quota']) if (body.storage[key] !== 'ok') issues.push(key + '-storage-unavailable');
    if (!body.features.email.configured) issues.push('email-unconfigured');
    if (body.features.moderationContact?.configured === false) issues.push('moderation-contact-unconfigured');
    if (body.features.staffAuth?.configured === false) issues.push('staff-auth-unconfigured');
    if (body.features.ai.enabled && !body.features.ai.configured) issues.push('ai-unconfigured');
    if (body.features.ai.state === 'capped') issues.push('ai-capped');
    if (body.features.turn.enabled && !body.features.turn.configured) issues.push('turn-unconfigured');
    const usage = body.usage.map(row => ({ name: row.name, used: row.used, limit: row.limit, unit: row.unit, period: row.period, scope: 'application' }));
    const warnings = usage.filter(row => row.used / row.limit >= .8).map(row => ({ name: row.name, percent: Math.floor(100 * row.used / row.limit), level: row.used >= row.limit ? 'capped' : 'warning' }));
    // Never render arbitrary server strings, rooms, identifiers or provider data.
    // Fixed unknown degradation reasons still produce a generic service alert.
    return { kind: body.service.state === 'unavailable' ? 'service-error' : issues.length ? 'degraded' : 'healthy', checkedAt: new Date(at).toISOString(), httpStatus,
        issues: [...new Set(issues)].sort(), usage, warnings, storageCheck: 'read-only', providerChecks: 'not-performed' };
}

async function probeHealth({ opsKey, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = TIMEOUT_MS } = {}) {
    const at = now(), controller = new AbortController(); let timer;
    const task = async () => {
        const response = await fetchImpl(ORIGIN + '/beta/health', { method: 'GET', redirect: 'error', signal: controller.signal,
            headers: { Authorization: 'Bearer ' + opsKey, Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; StalemateBetaHealth/1.0)' } });
        if (response.status === 401) return failure('authentication-error', at, 401);
        if (response.status === 403) return failure('access-blocked', at, 403);
        if (response.status !== 200 && response.status !== 503) return failure('service-error', at, response.status);
        const body = await readBounded(response, controller.signal);
        if (response.status === 503 && body?.error === 'ops-not-configured') return failure('endpoint-configuration-error', at, 503);
        validateHealth(body);
        if (Math.abs(Date.parse(body.checkedAt) - now()) > 10 * 60 * 1000) throw new ContractError();
        if (response.status === 503 && body.service.state !== 'unavailable') throw new ContractError();
        return classifyHealth(body, at, response.status);
    };
    try {
        return await Promise.race([task(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs); })]);
    } catch (error) { return failure(error instanceof ContractError ? 'response-contract-error' : 'network-error', at); }
    finally { clearTimeout(timer); controller.abort(); }
}

function signature(result) {
    return JSON.stringify({ kind: result.kind, issues: result.issues, warnings: result.warnings.map(row => ({ name: row.name, level: row.level })).sort((a, b) => a.name.localeCompare(b.name)) });
}
function healthy(result) { return result.kind === 'healthy' && !result.warnings.length; }

function notification(result, previous) {
    const labels = {
        'authentication-error': 'The health key was rejected. Check the private monitor configuration.',
        'access-blocked': 'The health endpoint was blocked. Check Cloudflare edge or Access routing.',
        'endpoint-configuration-error': 'The Worker health key is not configured.',
        'local-configuration-error': 'The local private monitor configuration needs repair.',
        'response-contract-error': 'The health response is invalid. Check the deployed monitor contract.',
        'network-error': 'The health probe timed out or could not connect. Check this computer’s network and the beta.',
        'service-error': 'The beta health probe reports service or storage unavailable.',
        degraded: 'The beta is responding with setup, admission or feature restrictions.'
    };
    if (healthy(result)) return { title: 'Stalemate beta recovered', message: 'Health is ready and application allowances are below 80%. Provider availability and billing are not checked.' };
    const descriptions = result.warnings.map(row => `${USAGE_NAMES[row.name]} ${row.percent}%${row.level === 'capped' ? ' (cap reached)' : ''}`);
    const message = [labels[result.kind], ...descriptions, descriptions.length ? 'Application allowances only; this is not a provider bill.' : 'Storage checks are read-only; provider availability and bills are not checked.'].filter(Boolean).join(' ');
    return { title: previous && previous.kind !== result.kind ? 'Stalemate beta status changed' : 'Stalemate beta needs attention', message };
}

async function desktopNotify(alert, { platform = process.platform, execImpl = execFile } = {}) {
    if (platform !== 'darwin') return { delivery: 'console-only' };
    await new Promise((resolve, reject) => execImpl('/usr/bin/osascript', ['-e', NOTIFICATION_SCRIPT, alert.title, alert.message], { timeout: 10000, maxBuffer: 4096 }, error => error ? reject(new Error('notification-unavailable')) : resolve()));
    return { delivery: 'submitted-to-os' };
}

async function runOnce({ configPath = defaultConfigPath(), dryRun = false, fetchImpl = globalThis.fetch, notify = desktopNotify, now = Date.now } = {}) {
    const paths = pathsForConfig(configPath); let result;
    try { const config = readConfig(configPath); result = await probeHealth({ ...config, fetchImpl, now }); }
    catch { result = failure('local-configuration-error', now()); }
    if (dryRun) return { ...result, dryRun: true, notification: 'not-requested', origin: ORIGIN };
    ensurePrivateDirectory(paths.directory);
    const previous = readState(paths.state), currentSignature = signature(result);
    let ackSignature = previous?.ackSignature || '', delivery = 'not-needed';
    const changed = ackSignature !== currentSignature;
    if (changed && (!healthy(result) || previous)) {
        try { delivery = (await notify(notification(result, previous)))?.delivery || 'submitted'; ackSignature = currentSignature; }
        catch { delivery = 'failed'; }
    } else if (changed) ackSignature = currentSignature; // quiet first healthy baseline
    const state = { version: 1, kind: result.kind, checkedAt: result.checkedAt, ackSignature, notification: delivery };
    writePrivate(paths.state, JSON.stringify(state, null, 2) + '\n');
    appendLog(paths.log, { at: result.checkedAt, kind: result.kind, issues: result.issues, warnings: result.warnings, notification: delivery });
    return { ...result, notification: delivery, origin: ORIGIN };
}

function cliArgs(argv) {
    const args = [...argv], command = args[0] && !args[0].startsWith('--') ? args.shift() : 'once';
    if (!['once', 'dry-run', 'test-alert', 'help'].includes(command)) throw new MonitorConfigError('unknown-command');
    let configPath = defaultConfigPath(), quiet = false;
    while (args.length) {
        const flag = args.shift();
        if (flag === '--config' && args[0] && !args[0].startsWith('--')) configPath = path.resolve(args.shift());
        else if (flag === '--quiet') quiet = true;
        else throw new MonitorConfigError('unknown-option');
    }
    return { command, configPath, quiet };
}

async function main(argv = process.argv.slice(2)) {
    const args = cliArgs(argv);
    if (args.command === 'help') {
        console.log('Usage: node beta-health-monitor.cjs once|dry-run|test-alert [--config /private/config.json] [--quiet]\nConfig: {"version":1,"opsKey":"32–256 non-whitespace characters"}; owner-only mode0600 on macOS/Linux, restricted owner ACL on Windows.\nOnly GET /beta/health is probed. dry-run does not write state or notify. test-alert makes no request. macOS desktop alerts require an awake, logged-in Mac and enabled notifications. Other platforms print local results; no scheduler or desktop integration is installed.'); return;
    }
    if (args.command === 'test-alert') {
        const outcome = await desktopNotify({ title: 'Stalemate beta monitor test', message: 'This is a local test notification. No beta outage was created and no provider was contacted.' });
        if (!args.quiet) console.log(JSON.stringify({ test: true, notification: outcome.delivery })); return;
    }
    const result = await runOnce({ configPath: args.configPath, dryRun: args.command === 'dry-run' });
    if (!args.quiet) console.log(JSON.stringify(result));
    if (['authentication-error', 'access-blocked', 'endpoint-configuration-error', 'local-configuration-error', 'response-contract-error', 'network-error', 'service-error'].includes(result.kind) || result.notification === 'failed') process.exitCode = 1;
}

module.exports = { ORIGIN, TIMEOUT_MS, USAGE_NAMES, NOTIFICATION_SCRIPT, MonitorConfigError, defaultConfigPath, readConfig, pathsForConfig,
    ensurePrivateDirectory, readState, writePrivate, appendLog, validateHealth, classifyHealth, probeHealth, signature, notification, desktopNotify, runOnce, cliArgs, main };
if (require.main === module) main().catch(() => { console.error('Beta monitor could not complete. Check private configuration, state permissions and local notification settings.'); process.exitCode = 1; });
