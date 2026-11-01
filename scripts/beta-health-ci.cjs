#!/usr/bin/env node
'use strict';

// No local configuration, saved state, guest admission or notifications. The
// shared probe fixes the origin and performs only the bearer-authenticated GET.
const { probeHealth } = require('./beta-health-monitor.cjs');

const LIMITATION = 'Read-only health check; provider availability and billing are not checked.';
const ERROR_KINDS = new Set(['authentication-error', 'access-blocked', 'endpoint-configuration-error',
    'response-contract-error', 'network-error', 'service-error']);

function report(label, code, log) {
    try { log(label + ': ' + LIMITATION); }
    catch { return 1; }
    return code;
}

async function run({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs, log = console.log } = {}) {
    let label = 'probe-error';
    try {
        const opsKey = env?.HANGOUT_BETA_OPS_KEY;
        if (typeof opsKey !== 'string' || opsKey.length < 32 || opsKey.length > 256 || /\s/.test(opsKey)) {
            return report('monitor-configuration-error', 1, log);
        }
        const result = await probeHealth({ opsKey, fetchImpl, now, timeoutMs });
        if (result && Array.isArray(result.warnings)) {
            if (result.kind === 'healthy') label = result.warnings.length ? 'allowance-warning' : 'healthy';
            else if (result.kind === 'degraded' || ERROR_KINDS.has(result.kind)) label = result.kind;
        }
    } catch { /* Unexpected errors never expose credentials or server details. */ }
    return report(label, label === 'healthy' ? 0 : 1, log);
}

module.exports = { run };

if (require.main === module) {
    if (process.argv.length !== 2) process.exitCode = report('monitor-configuration-error', 1, console.log);
    else run().then(code => { process.exitCode = code; }, () => {
        process.exitCode = report('probe-error', 1, console.log);
    });
}
