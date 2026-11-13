import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { useReducedMotion } from '../hooks/use-reduced-motion.ts';
import { AnimatedView } from '../internal/animated-view.ts';
import { cx } from '../internal/class-names.ts';
import { Shimmer } from '../motion/shimmer.tsx';

export const SKELETON_VARIANTS = ['pulse', 'shimmer'] as const;
export type SkeletonVariant = (typeof SKELETON_VARIANTS)[number];

export interface SkeletonProps {
    /** Tailwind height utility, e.g. `h-4`. Kept as a class so it stays token-driven. */
    readonly heightClassName?: string | undefined;
    readonly widthClassName?: string | undefined;
    readonly rounded?: 'none' | 'sm' | 'md' | 'base' | 'lg' | 'full' | undefined;
    /**
     * `sunken` (the default) fills the block with the sunken surface. `line` fills it with the
     * hairline colour, the shop's look: it stays visible on a raised card in the dark theme too.
     */
    readonly tone?: 'sunken' | 'line' | undefined;
    /**
     * `pulse` (the default) fades the block in and out. `shimmer` sweeps a highlight across it,
     * which reads better on a large block such as a card or an image placeholder.
     */
    readonly variant?: SkeletonVariant | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

const ROUNDED_CLASS = {
    none: 'rounded-none',
    sm: 'rounded-sm',
    md: 'rounded-md',
    base: 'rounded',
    lg: 'rounded-lg',
    full: 'rounded-full',
} as const;
const TONE_CLASS = { sunken: 'bg-surface-sunken', line: 'bg-stroke-subtle' } as const;

/*
 * On the web the pulse is a CSS animation: React Native Web has no native driver, so an `Animated`
 * loop would write every block's opacity from JavaScript on every frame, for as long as a page is
 * loading. Same curve and beat as the native loop below.
 */
const WEB_PULSE = StyleSheet.create({
    pulse: {
        // @ts-expect-error -- web-only style keys, absent from React Native's style types.
        animationKeyframes: [
            { '0%': { opacity: 0.4 }, '50%': { opacity: 0.9 }, '100%': { opacity: 0.4 } },
        ],
        animationDuration: '1400ms',
        animationTimingFunction: 'ease-in-out',
        animationIterationCount: 'infinite',
    },
}).pulse as StyleProp<ViewStyle>;
const WEB = Platform.OS === 'web';

/**
 * Skeleton placeholder.
 *
 * Under `prefers-reduced-motion` the animation is not slowed down, it is **removed**: a gentler
 * pulse is still a pulse, and vestibular triggers are about movement rather than speed. The static
 * form is a plain tinted block, which reads perfectly well as "content pending" — and it is the
 * same static block for both variants.
 *
 * The whole thing is hidden from assistive technology — announcing a placeholder rectangle is
 * noise. The surrounding region carries `aria-busy` instead.
 */
export function Skeleton({
    heightClassName = 'h-4',
    widthClassName = 'w-full',
    rounded = 'sm',
    tone = 'sunken',
    variant = 'pulse',
    className,
    testID,
}: SkeletonProps) {
    const reducedMotion = useReducedMotion();
    const pulse = useRef(new Animated.Value(0.4)).current;

    useEffect(() => {
        if (reducedMotion) {
            pulse.setValue(0.6);
            return;
        }
        // The shimmer carries its own motion, and the web pulses in CSS: no loop to run.
        if (variant === 'shimmer' || WEB) return;

        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, {
                    toValue: 0.9,
                    duration: 700,
                    easing: Easing.inOut(Easing.quad),
                    useNativeDriver: true,
                }),
                Animated.timing(pulse, {
                    toValue: 0.4,
                    duration: 700,
                    easing: Easing.inOut(Easing.quad),
                    useNativeDriver: true,
                }),
            ]),
        );
        loop.start();
        return () => {
            loop.stop();
        };
    }, [pulse, reducedMotion, variant]);

    const classes = cx(
        TONE_CLASS[tone],
        heightClassName,
        widthClassName,
        ROUNDED_CLASS[rounded],
        className,
    );

    if (reducedMotion) {
        return (
            <View
                testID={testID}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                aria-hidden
                className={classes}
            />
        );
    }

    if (variant === 'shimmer') {
        return (
            <View
                testID={testID}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                aria-hidden
                className={classes}
            >
                <Shimmer
                    testID={testID === undefined ? undefined : `${testID}-shimmer`}
                    className="h-full w-full"
                />
            </View>
        );
    }

    return (
        <AnimatedView
            testID={testID}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            aria-hidden
            className={classes}
            style={WEB ? WEB_PULSE : { opacity: pulse }}
        />
    );
}
