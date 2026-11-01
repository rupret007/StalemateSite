#!/usr/bin/env node
'use strict';

// User-level macOS scheduler only. The monitor itself runs on Node on all three
// desktop platforms. Never embed credentials in this file, a plist or argv.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const monitor = require('./beta-health-monitor.cjs');
const LABEL = 'com.stalemate.beta-monitor';
const INTERVAL = 300;
const xml = value => String(value).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

function stableNode(explicit) {
    const candidates = explicit ? [explicit] : ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'];
    for (const candidate of candidates) {
        if (!path.isAbsolute(candidate) || /[\x00-\x1f]/.test(candidate)) continue;
        try { fs.accessSync(candidate, fs.constants.X_OK); if (fs.statSync(candidate).isFile()) return candidate; } catch { /* next stable installation path */ }
    }
    throw new monitor.MonitorConfigError('stable-node-path-required');
}

function createPlan({ configPath = monitor.defaultConfigPath(), nodePath, home = os.homedir(), uid = process.getuid?.(), platform = process.platform } = {}) {
    if (platform !== 'darwin' || !Number.isInteger(uid) || uid <= 0) throw new monitor.MonitorConfigError('macos-user-session-required');
    configPath = path.resolve(configPath);
    if (/[\x00-\x1f]/.test(configPath)) throw new monitor.MonitorConfigError('config-path-invalid');
    const paths = monitor.pathsForConfig(configPath);
    return { label: LABEL, domain: 'gui/' + uid, target: 'gui/' + uid + '/' + LABEL,
        configPath, nodePath: stableNode(nodePath), intervalSeconds: INTERVAL,
        directory: paths.directory, runtime: path.join(paths.directory, 'monitor.cjs'),
        plist: path.join(home, 'Library', 'LaunchAgents', LABEL + '.plist'),
        stdout: path.join(paths.directory, 'launchd.stdout.log'), stderr: path.join(paths.directory, 'launchd.stderr.log'),
        state: paths.state, log: paths.log };
}

function plistFor(plan) {
    const args = [plan.nodePath, plan.runtime, 'once', '--config', plan.configPath, '--quiet'];
    return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        + '<plist version="1.0"><dict>\n'
        + `<key>Label</key><string>${xml(plan.label)}</string>\n`
        + '<key>ProgramArguments</key><array>' + args.map(arg => `<string>${xml(arg)}</string>`).join('') + '</array>\n'
        + `<key>StartInterval</key><integer>${INTERVAL}</integer>\n`
        + '<key>RunAtLoad</key><true/>\n<key>ProcessType</key><string>Background</string>\n'
        + '<key>LimitLoadToSessionType</key><string>Aqua</string>\n<key>Umask</key><integer>63</integer>\n'
        + `<key>StandardOutPath</key><string>${xml(plan.stdout)}</string>\n<key>StandardErrorPath</key><string>${xml(plan.stderr)}</string>\n`
        + '</dict></plist>\n';
}

function launch(args, spawnImpl = spawnSync) {
    const result = spawnImpl('/bin/launchctl', args, { encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
    return { ok: !result.error && result.status === 0, output: typeof result.stdout === 'string' ? result.stdout : '' };
}

function jobStatus(plan, spawnImpl) {
    const result = launch(['print', plan.target], spawnImpl);
    if (!result.ok) return { loaded: false };
    const state = result.output.match(/^\s*state = ([a-z ]+)$/m)?.[1];
    const lastExit = result.output.match(/^\s*last exit code = (-?\d+)$/m)?.[1];
    return { loaded: true, ...(state && { state }), ...(lastExit && { lastExitCode: Number(lastExit) }) };
}

function install(plan, { spawnImpl, sourcePath = __dirname + '/beta-health-monitor.cjs' } = {}) {
    // Validate before unloading or writing anything. The secret is read only in
    // this process; its value never enters launchctl, a plist, logs or output.
    monitor.readConfig(plan.configPath);
    const runtime = fs.readFileSync(sourcePath, 'utf8');
    monitor.ensurePrivateDirectory(plan.directory);
    if (jobStatus(plan, spawnImpl).loaded && !launch(['bootout', plan.target], spawnImpl).ok) throw new monitor.MonitorConfigError('launchagent-stop-failed');
    monitor.writePrivate(plan.runtime, runtime);
    for (const file of [plan.stdout, plan.stderr]) monitor.writePrivate(file, '');
    // LaunchAgents may already contain unrelated user agents. Do not chmod the
    // shared directory; only this one plist and this monitor's files are private.
    fs.mkdirSync(path.dirname(plan.plist), { recursive: true, mode: 0o700 });
    monitor.writePrivate(plan.plist, plistFor(plan));
    if (!launch(['enable', plan.target], spawnImpl).ok || !launch(['bootstrap', plan.domain, plan.plist], spawnImpl).ok) throw new monitor.MonitorConfigError('launchagent-start-failed');
    return { installed: true, label: plan.label, intervalSeconds: INTERVAL, ...jobStatus(plan, spawnImpl) };
}

function uninstall(plan, { spawnImpl } = {}) {
    if (jobStatus(plan, spawnImpl).loaded && !launch(['bootout', plan.target], spawnImpl).ok) throw new monitor.MonitorConfigError('launchagent-stop-failed');
    // Remove only our own regular plist; preserve private config, runtime, state
    // and logs for an explicit reinstall or operator-controlled deletion.
    let stat;
    try { stat = fs.lstatSync(plan.plist); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat) {
        if (!stat.isFile() || stat.isSymbolicLink() || process.getuid && stat.uid !== process.getuid()) throw new monitor.MonitorConfigError('launchagent-plist-invalid');
        fs.unlinkSync(plan.plist);
    }
    return { installed: false, label: plan.label, privateFilesPreserved: true };
}

function cliArgs(argv) {
    const args = [...argv], command = args[0] && !args[0].startsWith('--') ? args.shift() : 'plan';
    if (!['plan', 'install', 'uninstall', 'status', 'help'].includes(command)) throw new monitor.MonitorConfigError('unknown-command');
    const options = {};
    while (args.length) {
        const flag = args.shift();
        if (!['--config', '--node'].includes(flag) || !args[0] || args[0].startsWith('--') || !path.isAbsolute(args[0])) throw new monitor.MonitorConfigError('absolute-path-option-required');
        options[flag === '--config' ? 'configPath' : 'nodePath'] = args.shift();
    }
    return { command, options };
}

function main(argv = process.argv.slice(2)) {
    const args = cliArgs(argv);
    if (args.command === 'help') {
        console.log('Usage: node install-beta-monitor.cjs plan|install|status|uninstall [--config /private/config.json] [--node /stable/node]\nDefault: plan only; no mutation. macOS logged-in user only; never sudo. install validates private mode0600 config then copies runtime outside Documents, updates only this LaunchAgent and runs immediately/every five minutes. Reinstall to update copied code. uninstall stops the job and removes only its plist, preserving private configuration/state/logs.\nStartInterval probes are missed while asleep; desktop alerts require a logged-in, awake Mac, working network and notifications enabled. This is not independent uptime or provider billing monitoring. The core Node monitor also runs manually on Windows/Linux; this installer does not install their schedulers.'); return;
    }
    const plan = createPlan(args.options);
    const result = args.command === 'plan' ? { dryRun: true, ...plan, limits: 'No probes while asleep or logged out. Read-only application health and allowances; no provider availability or billing checks.' }
        : args.command === 'install' ? install(plan)
        : args.command === 'uninstall' ? uninstall(plan)
        : { label: plan.label, ...jobStatus(plan) };
    console.log(JSON.stringify(result, null, 2));
}

module.exports = { LABEL, INTERVAL, stableNode, createPlan, plistFor, launch, jobStatus, install, uninstall, cliArgs, main };
if (require.main === module) { try { main(); } catch (error) { console.error(error instanceof monitor.MonitorConfigError ? error.code : 'beta-monitor-install-failed'); process.exitCode = 1; } }
