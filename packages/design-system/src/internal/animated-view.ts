import { cssInterop } from 'nativewind';
import { Animated } from 'react-native';

/**
 * `Animated.View`, registered with NativeWind so that its `className` is honoured.
 *
 * NativeWind styles only the components it has been told about. It registers `View`, `Text`,
 * `Pressable` and the other core primitives, and not `Animated.View`, so a class on an animated view
 * was never turned into a style. On the web react-native-web then dropped the attribute outright:
 * the element carried its animated `opacity` and nothing else. Every pulsing `Skeleton` in the app
 * rendered 0px tall with no fill, so a list's loading state was an empty panel, and `Collapse`'s
 * `overflow-hidden`, `PageTransition`'s `flex-1` and `Shimmer`'s band never applied either.
 *
 * Registered here, once, and used through this name, so a component cannot reach the animated view
 * without the registration having run first. `Animated.Value` and friends still come from
 * `react-native`; only the element is this one.
 */
cssInterop(Animated.View, { className: 'style' });

export const AnimatedView = Animated.View;
