// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const monitor = require('../../scripts/beta-health-monitor.cjs');
const { run } = require('../../scripts/beta-health-ci.cjs');

const KEY = 'fixture-only-ci-monitor-key-never-print';
const NOW = Date.parse('2026-10-19T12:00:00Z');
function health() {
    return {
        version: 1, checkedAt: new Date(NOW).toISOString(),
        storageCheck: 'read-only', providerChecks: 'not-performed',
        service: { state: 'ready', reasons: [] },
        admission: { state: 'open', lock: 'off', shield: false, lockAuto: false },
        storage: { lobby: 'ok', registry: 'ok', quota: 'ok' },
        features: {
            email: { configured: true, provider: 'not-probed' },
            ai: { enabled: false, configured: false, state: 'disabled' },
            turn: { enabled: false, configured: false, providerUsage: 'unknown' }
        },
        usage: [{ name: 'connections', used: 7, limit: 100, unit: 'connections', scope: 'application', period: 'day' }]
    };
}
async function check(fetchImpl, env = { HANGOUT_BETA_OPS_KEY: KEY }) {
    const lines = [];
    const code = await run({ env, fetchImpl, now: () => NOW, log: line => lines.push(line) });
    return { code, lines };
}

describe('unattended health job uses actual bounded probe and only fixed public labels', () => {
    it('accepts a healthy beta with optional providers disabled, without printing response details', async () => {
        const body = health(); body.privateUnexpectedText = 'private-room-and-visitor-claim';
        const fetchImpl = vi.fn(async () => Response.json(body));
        const result = await check(fetchImpl);
        expect(result.code).toBe(0); expect(result.lines).toHaveLength(1);
        expect(result.lines[0]).toMatch(/^healthy:/);
        expect(result.lines[0]).toContain('provider availability and billing are not checked');
        expect(result.lines.join('')).not.toMatch(/private-room|visitor-claim|connections|fixture-only|workers\.dev/);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, options] = fetchImpl.mock.calls[0];
        expect(url).toBe(monitor.ORIGIN + '/beta/health');
        expect(options).toMatchObject({ method: 'GET', redirect: 'error', headers: { Authorization: 'Bearer ' + KEY } });
        expect(options.headers.Cookie).toBeUndefined();
    });

    it.each(['paused', 'shield', 'ai-failure'])('fails a valid HTTP200 %s restriction rather than leaving a green job', async restriction => {
        const body = health();
        if (restriction === 'paused') body.admission.state = 'paused';
        if (restriction === 'shield') body.admission.shield = true;
        if (restriction === 'ai-failure') body.features.ai = { enabled: true, configured: true, state: 'degraded' };
        const result = await check(async () => Response.json(body));
        expect(result.code).toBe(1); expect(result.lines).toHaveLength(1);
        expect(result.lines[0]).toMatch(/^degraded:/);
        expect(result.lines[0]).not.toContain(restriction);
    });

    it.each([80, 100])('fails a healthy HTTP200 at %i%% allowance with no counter disclosure', async used => {
        const body = health(); body.usage[0].used = used;
        const result = await check(async () => Response.json(body));
        expect(result.code).toBe(1); expect(result.lines).toHaveLength(1);
        expect(result.lines[0]).toMatch(/^allowance-warning:/);
        expect(result.lines[0]).not.toMatch(/connections|80|100/);
    });

    it.each([
        [401, { error: KEY }, 'authentication-error'],
        [403, '<html>private Access details</html>', 'access-blocked'],
        [503, { error: 'ops-not-configured' }, 'endpoint-configuration-error'],
        [502, 'private provider error ' + KEY, 'service-error'],
        [200, '{invalid private body', 'response-contract-error']
    ])('fails HTTP%s without echoing response details', async (status, body, label) => {
        const result = await check(async () => typeof body === 'string' ? new Response(body, { status }) : Response.json(body, { status }));
        expect(result.code).toBe(1); expect(result.lines).toHaveLength(1);
        expect(result.lines[0]).toMatch(new RegExp('^' + label + ':'));
        expect(result.lines.join('')).not.toMatch(/fixture-only|private|<html>|invalid/);
    });

    it('fails required storage503 without exposing health counters or evidence', async () => {
        const body = health(); body.service = { state: 'unavailable', reasons: ['lobby-unavailable'] }; body.storage.lobby = 'unavailable';
        const result = await check(async () => Response.json(body, { status: 503 }));
        expect(result.code).toBe(1); expect(result.lines[0]).toMatch(/^service-error:/);
        expect(result.lines[0]).not.toMatch(/lobby|connections|used|limit/);
    });

    it('sanitizes network exceptions and uses the fixed error label', async () => {
        const result = await check(async () => { throw new Error(KEY + ' private request text'); });
        expect(result.code).toBe(1); expect(result.lines).toHaveLength(1);
        expect(result.lines[0]).toMatch(/^network-error:/);
        expect(result.lines[0]).not.toContain(KEY);
    });

    it.each([undefined, '', 'short', 'x'.repeat(257), 'x'.repeat(32) + '\n'])('rejects invalid or absent credentials before any network call', async key => {
        const fetchImpl = vi.fn();
        const result = await check(fetchImpl, { HANGOUT_BETA_OPS_KEY: key });
        expect(result.code).toBe(1); expect(fetchImpl).not.toHaveBeenCalled();
        expect(result.lines).toHaveLength(1); expect(result.lines[0]).toMatch(/^monitor-configuration-error:/);
        expect(result.lines[0]).not.toContain('short');
    });
});
