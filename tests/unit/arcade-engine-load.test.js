import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ENGINE_LOAD_FAILURE, createEngineLoadFailure, loadEngine } from '../../r/45662413410ed051/lobby/arcade-engine-load.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lobby = name => readFileSync(path.join(root, 'r/45662413410ed051/lobby', name), 'utf8');

describe('a failed Game Night engine chunk', () => {
    it('says the game did not load and lets Retry try the import again', async () => {
        const rejections = [];
        const hear = reason => rejections.push(reason);
        process.on('unhandledRejection', hear);
        const status = document.createElement('p');
        const main = document.createElement('button');
        document.body.append(status, main);
        const panel = createEngineLoadFailure(status, main);
        const slot = { current: null };
        let attempts = 0;
        const start = () => {
            attempts += 1;
            if (attempts < 3) return Promise.reject(new Error('missing chunk'));
            return Promise.resolve();
        };
        let resume = 0;
        let pending;
        const retry = () => {
            pending = loadEngine(slot, start, () => panel.fail(retry), () => panel.loaded(retry)).then(ok => {
                if (ok) resume += 1;
                return ok;
            });
            return pending;
        };
        try {
            await expect(retry()).resolves.toBe(false);
            expect(ENGINE_LOAD_FAILURE).toBe('Couldn\u2019t load the game. Tap Retry.');
            expect(status.textContent).toBe(ENGINE_LOAD_FAILURE);
            expect(panel.button.hidden).toBe(false);
            expect(panel.button.textContent).toBe('Retry');
            expect(main.hidden).toBe(true);
            status.textContent = 'Connecting…';
            main.hidden = false;
            expect(panel.hold()).toBe(true);
            expect(status.textContent).toBe(ENGINE_LOAD_FAILURE);
            expect(panel.button.hidden).toBe(false);
            expect(main.hidden).toBe(true);

            panel.button.click();
            await expect(pending).resolves.toBe(false);
            expect(status.textContent).toBe(ENGINE_LOAD_FAILURE);
            expect(panel.button.hidden).toBe(false);
            expect(resume).toBe(0);

            panel.button.click();
            await expect(pending).resolves.toBe(true);
            expect(resume).toBe(1);
            expect(panel.button.hidden).toBe(true);
            expect(panel.showing()).toBe(false);
            expect(attempts).toBe(3);
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(rejections).toEqual([]);
        } finally {
            process.off('unhandledRejection', hear);
            status.remove();
            main.remove();
            panel.button.remove();
        }
    });

    it('wires every lazy engine through the shared failure path', () => {
        const files = [
            'arcade-chess.mjs',
            'arcade-turdrush.mjs',
            'arcade-turdanoid.mjs',
            'arcade-turdtris.mjs',
            'arcade-turdspades.mjs',
            'arcade-turdomania.mjs',
            'arcade-turdrummy.mjs'
        ];
        for (const file of files) {
            const source = lobby(file);
            expect(source, file).toContain("from './arcade-engine-load.mjs'");
            expect(source, file).toContain('loadEngine(');
            expect(source, file).toContain('createEngineLoadFailure(');
            expect(source, file).toContain('engineLoad.fail(');
            expect(source, file).not.toMatch(/\?\?=\s*(?:Promise\.all|import)\(/);
        }
    });
});
