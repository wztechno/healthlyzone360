import { defineConfig } from 'vitest/config';

// `@healthy360/testing`'s shared helper is deliberately not used here: this package is a dependency
// of the mock repository world that `@healthy360/testing` itself reaches for, and a devDependency
// back would create a cycle in the Turborepo task graph. The config below duplicates that helper.
export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
        passWithNoTests: false,
    },
});
