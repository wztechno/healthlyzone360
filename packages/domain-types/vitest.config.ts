import { defineConfig } from 'vitest/config';

// This package cannot use `@healthy360/testing`'s shared config helper: `@healthy360/testing`
// depends on `@healthy360/domain-types`, and a devDependency back would create a cycle in the
// Turborepo task graph. The config below is deliberately a duplicate of that helper's output.
export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
        passWithNoTests: false,
    },
});
