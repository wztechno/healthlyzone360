import { useMotion } from '@healthy360/design-system';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, Easing, Platform, View } from 'react-native';

/** The accepted boards' `up` entrance: a 12px rise and fade, each card a beat after the last. */
const RISE_MS = 600;
const RISE_STAGGER_MS = 60;
const RISE_PX = 12;
/** Past the cards a laptop shows at once, the rest rise together. */
const RISE_STAGGERED = 8;
const RISE_EASING = Easing.bezier(0.2, 0.7, 0.2, 1);

/**
 * A card rising into its row or grid. Mounting it plays the rise, so a parent that wants it again
 * — another shelf picked, the menu filtered — gives the cards a new key. Reduced motion shows them
 * at once.
 */
export function RiseIn({
    index,
    className,
    style,
    children,
}: {
    readonly index: number;
    readonly className?: string | undefined;
    readonly style?: { readonly width?: number } | undefined;
    readonly children: ReactNode;
}) {
    const { enabled } = useMotion();
    const [shown] = useState(() => new Animated.Value(enabled ? 0 : 1));

    useEffect(() => {
        if (!enabled) {
            shown.setValue(1);
            return undefined;
        }
        const animation = Animated.timing(shown, {
            toValue: 1,
            duration: RISE_MS,
            delay: Math.min(index, RISE_STAGGERED) * RISE_STAGGER_MS,
            easing: RISE_EASING,
            useNativeDriver: Platform.OS !== 'web',
        });
        animation.start();
        return () => {
            animation.stop();
        };
    }, [enabled, index, shown]);

    // The layout classes go on a plain view — NativeWind styles a `View`, not every animated
    // component — and the rise on the one inside it, which fills it.
    return (
        <View {...(className === undefined ? {} : { className })} style={style}>
            <Animated.View
                style={{
                    flexGrow: 1,
                    opacity: shown,
                    transform: [
                        {
                            translateY: shown.interpolate({
                                inputRange: [0, 1],
                                outputRange: [RISE_PX, 0],
                            }),
                        },
                    ],
                }}
            >
                {children}
            </Animated.View>
        </View>
    );
}
