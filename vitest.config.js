const { defineConfig, configDefaults } = require('vitest/config');

const capacityFixtures = [
    'tests/unit/hangout-lobby-media-blocking-capacity.test.js',
    'tests/unit/hangout-participation-capacity.test.js'
];

module.exports = defineConfig({
    test: {
        environment: 'jsdom',
        // Project include arrays merge with this one; keep the root empty so
        // the capacity project cannot inherit the ordinary project's globs.
        include: [],
        setupFiles: ['./tests/setup/vitest.setup.js'],
        restoreMocks: true,
        clearMocks: true,
        projects: [
            {
                extends: true,
                test: {
                    name: 'unit',
                    include: ['tests/unit/**/*.test.js', 'hangout-worker/tests/**/*.test.js'],
                    exclude: [...configDefaults.exclude, ...capacityFixtures],
                    // Positive groups preserve this order with --no-file-parallelism.
                    sequence: { groupOrder: 1 }
                }
            },
            {
                extends: true,
                test: {
                    name: 'accepted-room-capacity',
                    include: capacityFixtures,
                    // These fixtures fill 30 rooms or admit 150 C3 guests.
                    // Reduce test-runner CPU contention during setup by running
                    // after the other files. Keep the real 50ms overload guard,
                    // all setup actions and refusal assertions.
                    sequence: { groupOrder: 2 },
                    maxWorkers: 1,
                    fileParallelism: false
                }
            }
        ]
    }
});
