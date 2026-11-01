// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(fileURLToPath(new URL('../..', import.meta.url)));
const roomJs = readFileSync(join(repoRoot, 'r/45662413410ed051/room.js'), 'utf8');

describe('hangout invite gate', () => {
    it('opens the gate for preview or a fragment invite, not a bare room URL', () => {
        const startBlock = roomJs.match(/async function start\(\)[\s\S]*?ui\.copy\.addEventListener/)?.[0] || '';
        expect(startBlock).toContain('!previewKey && !invite');
        expect(startBlock).toContain('Not open yet');
        expect(startBlock).toContain('You’re invited');
    });

    it('dials the relay with the global preview key or the invite fragment token', () => {
        const connectBlock = roomJs.match(/function connect\(\)[\s\S]*?ws\.onclose/m)?.[0] || '';
        expect(connectBlock).toContain('relayAdmission');
        expect(connectBlock, 'relay WebSocket URL').not.toMatch(/preview=/);
        expect(connectBlock).toMatch(/new WebSocket\(url(?:, \[admission\])?\)/);
    });
});
