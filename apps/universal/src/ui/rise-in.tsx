import { useMotion } from '@healthy360/design-system';
import { createElement, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, Easing, Platform, View } from 'react-native';

/** The accepted boards' `up` entrance: a 12px rise and fade, each card a beat after the last. */
const RISE_MS = 600;
const RISE_STAGGER_MS = 60;
const RISE_PX = 12;
/** Past the cards a laptop shows at once, the rest rise together. */
const RISE_STAGGERED = 8;
const RISE_EASING = Easing.bezier(0.2, 0.7, 0.2, 1);

/*
 * On the web the rise is a CSS animation. React Native Web has no native driver, so an `Animated`
 * rise costs a JavaScript style write per card per frame — a shelf switch rising eighteen cards
 * at once while it mounts them stutters. The browser runs keyframes off that thread.
 */
const STYLE_ID = 'h360-rise-in';
const STYLES = `
@keyframes h360-rise{from{opacity:0;transform:translateY(${String(RISE_PX)}px)}to{opacity:1;transform:none}}
.h360-rise{display:flex;flex-direction:column;flex-grow:1;animation:h360-rise ${String(RISE_MS)}ms cubic-bezier(.2,.7,.2,1) both}
@media (prefers-reduced-motion: reduce){.h360-rise{animation:none}}
`;

function injectRiseStyles(): void {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLES;
    document.head.appendChild(style);
}

interface RiseInProps {
    readonly index: number;
    readonly className?: string | undefined;
    readonly style?: { readonly width?: number } | undefined;
    readonly children: ReactNode;
}

/**
 * A card rising into its row or grid. Mounting it plays the rise, so a parent that wants it again
 * — another shelf picked, the menu filtered — gives the cards a new key. Reduced motion shows them
 * at once.
 */
export function RiseIn(props: RiseInProps) {
    return Platform.OS === 'web' ? <RiseInWeb {...props} /> : <RiseInNative {...props} />;
}

function RiseInWeb({ index, className, style, children }: RiseInProps) {
    const { enabled } = useMotion();
    // Before the first paint, so the card never shows before its keyframes exist.
    if (enabled) injectRiseStyles();

    return (
        <View {...(className === undefined ? {} : { className })} style={style}>
            {enabled
                ? createElement(
                      'div',
                      {
                          className: 'h360-rise',
                          style: {
                              animationDelay: `${String(Math.min(index, RISE_STAGGERED) * RISE_STAGGER_MS)}ms`,
                          },
                      },
                      children,
                  )
                : children}
        </View>
    );
}

function RiseInNative({ index, className, style, children }: RiseInProps) {
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
            useNativeDriver: true,
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
