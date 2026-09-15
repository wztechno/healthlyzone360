/**
 * Component tests run under jest-expo, exactly as `apps/universal` does — React Native Testing
 * Library is not viable under Vitest (dependency-compatibility.md), and a design system tested with
 * a different renderer than the application uses is not tested at all.
 *
 * @type {import('jest').Config}
 */
module.exports = {
    preset: 'jest-expo',
    roots: ['<rootDir>/src'],
    testMatch: ['**/*.test.ts', '**/*.test.tsx'],
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    // Contention headroom, not license for slow tests — anything near this alone is a defect.
    //
    // The real fix for contention is the worker caps (`--maxWorkers=2` here, one worker per package
    // in `@healthy360/testing`'s Vitest factory): a budget the 8-core machine can meet beats a
    // budget large enough to survive eighty processes fighting over it. This stays as the backstop
    // for the tail — a suite that loses its slice for a moment should be slow, not failed.
    testTimeout: 30000,
    transformIgnorePatterns: [
        'node_modules/(?!(?:\\.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|react-navigation|@react-navigation/.*|nativewind|react-native-css-interop|react-native-safe-area-context|@healthy360/.*))',
    ],
    collectCoverageFrom: ['src/**/*.{ts,tsx}'],
};
