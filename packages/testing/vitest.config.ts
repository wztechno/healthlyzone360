import { defineConfig } from 'vitest/config';

// This package *is* the shared config helper, so it configures itself directly rather than
// importing its own export.
export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
        passWithNoTests: false,
    },
});
