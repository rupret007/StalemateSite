// @vitest-environment node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    TEST_SLUG,
    productFile,
    productRepoPath,
    productRoomDir,
    productRoomName,
    productRoomPath,
    rewriteRoomRequest,
    roomPath
} from '../support/product-room.cjs';

describe('product room discovery', () => {
    it('finds the on-disk lobby and keeps the public test slug synthetic', () => {
        expect(TEST_SLUG).toBe('e2e-lobby');
        expect(productRoomName).not.toBe(TEST_SLUG);
        expect(existsSync(productFile('lobby/index.html'))).toBe(true);
        expect(productRoomDir.endsWith(productRoomName)).toBe(true);
        expect(productRepoPath('lobby/index.html')).toBe(`r/${productRoomName}/lobby/index.html`);
        expect(productRoomPath('lobby/')).toBe(`/r/${productRoomName}/lobby/`);
        expect(roomPath('lobby/')).toBe('/r/e2e-lobby/lobby/');
        expect(roomPath()).toBe('/r/e2e-lobby/');
    });

    it('rewrites only the synthetic room prefix onto the discovered directory', () => {
        expect(rewriteRoomRequest('/r/e2e-lobby/lobby/')).toBe(productRoomPath('lobby/'));
        expect(rewriteRoomRequest('/r/e2e-lobby')).toBe(`/r/${productRoomName}`);
        expect(rewriteRoomRequest('/StalemateSite/r/e2e-lobby/names.js')).toBe(`/StalemateSite/r/${productRoomName}/names.js`);
        expect(rewriteRoomRequest('/r/e2e-lobby-extra/lobby/')).toBe('/r/e2e-lobby-extra/lobby/');
        expect(rewriteRoomRequest('/play/')).toBe('/play/');
        expect(existsSync(join(productRoomDir, 'lobby/index.html'))).toBe(true);
    });

    it('does not embed the discovered room id in e2e sources', () => {
        const root = join(productRoomDir, '../../tests/e2e');
        const hits = [];
        const walk = directory => {
            for (const entry of readdirSync(directory)) {
                const file = join(directory, entry);
                if (statSync(file).isDirectory()) walk(file);
                else if (readFileSync(file, 'utf8').includes(productRoomName)) hits.push(file);
            }
        };
        walk(root);
        expect(hits).toEqual([]);
    });
});
