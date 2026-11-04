// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDiagnostics } = require('../../scripts/lib/natural-expiry-diagnostics.cjs');
const receipt = JSON.parse(readFileSync(new URL('../../pr-assets/beta-collaboration/20261031/private-demo-progress/receipt.json', import.meta.url), 'utf8'));
const lobbyJs = readFileSync(new URL('../../r/45662413410ed051/lobby/lobby.js', import.meta.url), 'utf8');
const discovery = readFileSync(new URL('../../r/45662413410ed051/lobby/discovery-core.js', import.meta.url), 'utf8');

describe('beta session expiry terminal lobby state', () => {
    it('documents ended as the session-revocation connection state, not offline', () => {
        expect(lobbyJs).toContain("ended: 'Session ended'");
        expect(lobbyJs).toMatch(/setConnection\('ended'\)/);
        expect(discovery).toContain("'ended'");
        expect(discovery).toMatch(/session has ended/i);
    });

    it('records the corrected hosted expiry observation criteria', () => {
        expect(receipt.expiry.observedCriteria.lobbyEndedClosed).toBe(true);
        expect(receipt.expiry.finding).toMatch(/ends the session with ended/);
    });

    it('preserves ended in sanitized natural-expiry lobby observations', () => {
        const cache = createDiagnostics({ startedAtMs: 1_800_000_000_000, maxElapsedMs: 8 * 60 * 60 * 1000 });
        cache.record('lobby', { available: true, connection: 'ended', roleIsGuestFan: true, pmCount: 0, channelCount: 1,
            socketState: 3, observedSockets: 1, currentSocketGeneration: 1, opens: [], closes: [{ generation: 1, code: 4401, at: 1_800_028_830_000 }], unknownCloseCodes: 0 }, { atMs: 1_800_028_830_000, elapsedMs: 28_830_000 });
        expect(cache.read().pages.lobby.lastSnapshot.connection).toBe('ended');
    });
});
