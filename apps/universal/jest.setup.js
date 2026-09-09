/**
 * jest-expo setup.
 *
 * `expo-localization` and `expo-constants` reach for native modules that do not exist in the Node
 * test environment, so they are stubbed with the values the tests need. Everything else runs for
 * real — the point of these tests is to exercise the actual component tree.
 */
jest.mock('expo-localization', () => ({
    getLocales: () => [
        {
            languageTag: 'en-GB',
            languageCode: 'en',
            regionCode: 'GB',
            textDirection: 'ltr',
            measurementSystem: 'metric',
        },
    ],
    getCalendars: () => [{ timeZone: 'UTC', calendar: 'gregory', uses24hourClock: true }],
}));

jest.mock('expo-font', () => ({
    useFonts: () => [true, null],
    loadAsync: jest.fn(async () => undefined),
    isLoaded: () => true,
}));

/**
 * `react-native-safe-area-context` is deliberately **not** mocked: NativeWind patches it through
 * `react-native-css-interop`, and the library's own Jest mock does not satisfy that patch. Tests
 * feed the real provider fixed metrics via `<AppProviders initialMetrics={…}>` instead, which also
 * keeps the component tree under test identical to the one that ships.
 */

/**
 * `waitFor` keeps its own clock, and `testTimeout` is not it.
 *
 * React Native Testing Library defaults `asyncUtilTimeout` to **1000 ms**, independent of Jest's
 * per-test budget. So a `waitFor` that needs longer than a second fails as "unable to find an
 * element" — an assertion-shaped failure, not a timeout — and raising `testTimeout` does nothing
 * for it. Under `pnpm turbo run test` that is exactly what a starved suite hits: the element is on
 * its way and the clock runs out first.
 *
 * Five seconds is headroom for a loaded machine while still failing fast on a query that is simply
 * wrong — the alternative, letting it ride Jest's 30 s budget, turns every genuine typo in a
 * testID into a half-minute wait.
 */
const { configure } = require('@testing-library/react-native');
configure({ asyncUtilTimeout: 5000 });
