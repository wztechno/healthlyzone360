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
    // `pnpm turbo run test` executes every package's suite at once; under that CPU contention a
    // file that finishes in ~7 s alone takes ~27 s, and jest's default 5 s per-test budget fails
    // healthy tests (observed: Select's placeholder test, twice on 2026-07-31). The budget below
    // is contention headroom, not license for slow tests — anything near it alone is a defect.
    testTimeout: 20000,
    transformIgnorePatterns: [
        'node_modules/(?!(?:\\.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|react-navigation|@react-navigation/.*|nativewind|react-native-css-interop|react-native-safe-area-context|@healthy360/.*))',
    ],
    collectCoverageFrom: ['src/**/*.{ts,tsx}'],
};
