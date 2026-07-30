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
