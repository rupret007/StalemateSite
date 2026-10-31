import { defineConfig, mergeConfig } from 'vitest/config';
import { createRequire } from 'node:module';
const base = createRequire(import.meta.url)('../vitest.config.js');

// Keep all existing tests; place new coverage within this lane's allowed paths.
export default mergeConfig(base, defineConfig({
    test: { include: ['tests/unit/**/*.test.js', 'hangout-worker/tests/**/*.test.js'], maxWorkers: 2 }
}));
