// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(fileURLToPath(new URL('../..', import.meta.url)));

describe('CI and Pages workflow', () => {
    it('runs checks on every push and only deploys Pages from main after they pass', async () => {
        const yaml = await readFile(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');

        expect(yaml).toContain('node-version: 24');
        expect(yaml).toContain('npm test');
        expect(yaml).toContain('npx playwright install --with-deps chromium webkit');
        expect(yaml).toMatch(/needs:\s*test/);
        expect(yaml).toContain("github.event_name == 'push'");
        expect(yaml).toContain("github.ref == 'refs/heads/main'");
        expect(yaml).toContain('actions/deploy-pages@');
        expect(yaml).toContain('actions/upload-pages-artifact@');
        expect(yaml).toContain('npm run package:pages');
        expect(yaml).not.toMatch(/continue-on-error:\s*true/);
    });
});
