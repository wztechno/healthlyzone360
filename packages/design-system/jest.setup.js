/**
 * jest-expo setup for the design system.
 *
 * Only `expo-font` is stubbed, because a component that asks whether a face has loaded must not
 * reach for a native module in Node. Everything else — including NativeWind's
 * `react-native-css-interop` patching of `react-native-safe-area-context` — runs for real, so the
 * tree under test is the tree that ships.
 */
jest.mock('expo-font', () => ({
    useFonts: () => [true, null],
    loadAsync: jest.fn(async () => undefined),
    isLoaded: () => true,
}));

/**
 * `getByTestId` hides accessibility-hidden nodes by default, which is the right default for a
 * *query* but wrong for a design system's own tests: decorative icons and backdrops are hidden **on
 * purpose**, and their hidden-ness is asserted explicitly on the props. Structural queries therefore
 * see the whole tree.
 */
const { configure } = require('@testing-library/react-native');
configure({ defaultIncludeHiddenElements: true });
