const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
    test: {
        environment: 'jsdom',
        include: ['tests/unit/**/*.test.js'],
        setupFiles: ['./tests/setup/vitest.setup.js'],
        restoreMocks: true,
        clearMocks: true
    }
});
