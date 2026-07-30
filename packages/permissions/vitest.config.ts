import { defineConfig } from 'vitest/config';

// Cannot use `@healthy360/testing`'s helper here: that package depends on this one, and a
// devDependency back would create a cycle in the Turborepo task graph.
export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
        passWithNoTests: false,
    },
});
