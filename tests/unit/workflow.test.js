// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(fileURLToPath(new URL('../..', import.meta.url)));

function expectBrowserProvisioning(yaml, lockedVersion) {
    if (!yaml.includes('    container:')) {
        expect(yaml).toContain('npx playwright install --with-deps chromium webkit');
        return;
    }
    expect(lockedVersion).toBe('1.64.1');
    expect(yaml).toContain('image: mcr.microsoft.com/playwright:v1.64.1-noble@sha256:d65108d1a8095d8b0c4a5e32bf1807a40a5ce90ff0c78473e1116b1c243235e8');
    expect(yaml).toContain('options: --user 1001');
    expect(yaml).toContain("assert.equal(require('playwright/package.json').version, '1.64.1')");
    expect(yaml).toContain('for (const browser of [chromium, webkit])');
    expect(yaml).toContain('fs.accessSync(browser.executablePath(), fs.constants.X_OK)');
    expect(yaml).not.toMatch(/\b(?:apt-get|sudo)\b/);
}

describe('CI and Pages workflow', () => {
    it('runs checks on every push and only deploys Pages from main after they pass', async () => {
        const yaml = await readFile(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');

        expect(yaml).toContain('node-version: 24');
        expect(yaml).toContain('npm test');
        const lock = JSON.parse(await readFile(join(repoRoot, 'package-lock.json'), 'utf8'));
        expectBrowserProvisioning(yaml, lock.packages['node_modules/playwright'].version);

        const playwright = await readFile(join(repoRoot, 'playwright.config.js'), 'utf8');
        expect(playwright).toContain('webkit-iphone-se');
        expect(playwright).toContain('webkit-iphone-15');
        expect(playwright).toContain('webkit-iphone-15-pro-max');
        expect(playwright).toContain('chromium-android');
        expect(playwright).toMatch(/phones\\.spec\\.js/);
        expect(playwright).toContain('width: 375, height: 667');
        expect(playwright).toContain('width: 393, height: 852');
        expect(playwright).toContain('width: 430, height: 932');
        expect(playwright).toContain('width: 360, height: 800');
        expect(yaml).toMatch(/needs:\s*test/);
        expect(yaml).toContain("github.event_name == 'push'");
        expect(yaml).toContain("github.ref == 'refs/heads/main'");
        expect(yaml).toContain('actions/deploy-pages@');
        expect(yaml).toContain('actions/upload-pages-artifact@');
        expect(yaml).toContain('npm run package:pages');
        expect(yaml).not.toMatch(/continue-on-error:\s*true/);
    });

    it('retains the hosted-install provisioning contract', () => {
        expectBrowserProvisioning('run: npx playwright install --with-deps chromium webkit', '1.64.1');
    });

    it.each([
        ['hosted installation without dependencies', 'run: npx playwright install chromium webkit'],
        ['hosted installation without WebKit', 'run: npx playwright install --with-deps chromium'],
        ['untrusted image registry', 'registry'],
        ['unpinned image', 'digest'],
        ['different browser version', 'version'],
        ['missing executable verification', 'executable'],
        ['missing WebKit verification', 'webkit'],
        ['privileged container user', 'user'],
    ])('refuses invalid browser provisioning: %s', async (_, mutation) => {
        const yaml = await readFile(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
        let invalid = mutation;
        if (mutation === 'registry') invalid = yaml.replace('mcr.microsoft.com/playwright:', 'example.invalid/playwright:');
        if (mutation === 'digest') invalid = yaml.replace(/@sha256:[0-9a-f]{64}/, '');
        if (mutation === 'version') invalid = yaml.replaceAll('1.64.1', '1.64.0');
        if (mutation === 'executable') invalid = yaml.replace('fs.accessSync(browser.executablePath(), fs.constants.X_OK)', '');
        if (mutation === 'webkit') invalid = yaml.replace('[chromium, webkit]', '[chromium]');
        if (mutation === 'user') invalid = yaml.replace('options: --user 1001', 'options: --user 0');
        expect(() => expectBrowserProvisioning(invalid, '1.64.1')).toThrow();
    });
});
