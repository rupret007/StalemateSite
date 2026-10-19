import { defineConfig } from 'vitest/config';

// Independent deployment regression suite. Every provider request uses a fixture.
export default defineConfig({
    test: {
        environment: 'node',
        include: ['hangout-worker/tests/**/*.test.js'],
        restoreMocks: true,
        clearMocks: true,
        maxWorkers: 2
    }
});
