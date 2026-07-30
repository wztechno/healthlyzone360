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
    transformIgnorePatterns: [
        'node_modules/(?!(?:\\.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|react-navigation|@react-navigation/.*|nativewind|react-native-css-interop|react-native-safe-area-context|@healthy360/.*))',
    ],
    collectCoverageFrom: ['src/**/*.{ts,tsx}'],
};
