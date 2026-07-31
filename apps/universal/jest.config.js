/**
 * React Native rendering tests run under jest-expo; pure-TypeScript packages run under Vitest.
 * The split is deliberate — React Native Testing Library is not viable under Vitest
 * (dependency-compatibility.md).
 *
 * `transformIgnorePatterns` has to let three extra families through: NativeWind and its
 * `react-native-css-interop` runtime, the Google Fonts packages, and `@healthy360/*` workspace
 * packages, which publish untranspiled TypeScript source.
 *
 * @type {import('jest').Config}
 */
module.exports = {
    preset: 'jest-expo',
    roots: ['<rootDir>/app', '<rootDir>/src', '<rootDir>/__tests__'],
    testMatch: ['**/*.test.ts', '**/*.test.tsx'],
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    // Fourteen suites saturate every core, and under `pnpm turbo run test` the other packages'
    // suites contend too; a screen test that runs in well under a second alone can then cross
    // jest's default 5 s budget (observed: PlanDetailScreen's configurator test, 2026-07-31 —
    // and the design-system Select test, same day, same cause; both pass instantly alone).
    // Contention headroom only — a test that needs this long alone is a defect.
    testTimeout: 20000,
    transformIgnorePatterns: [
        'node_modules/(?!(?:\\.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|react-native-svg|nativewind|react-native-css-interop|react-native-safe-area-context|@healthy360/.*))',
    ],
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
    collectCoverageFrom: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
};
