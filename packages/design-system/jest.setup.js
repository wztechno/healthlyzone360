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
configure({ defaultIncludeHiddenElements: true, asyncUtilTimeout: 5000 });
