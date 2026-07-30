import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';

import { useReducedMotion } from '../hooks/use-reduced-motion.ts';
import { cx } from '../internal/class-names.ts';

export interface SkeletonProps {
    /** Tailwind height utility, e.g. `h-4`. Kept as a class so it stays token-driven. */
    readonly heightClassName?: string | undefined;
    readonly widthClassName?: string | undefined;
    readonly rounded?: 'sm' | 'md' | 'full' | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

const ROUNDED_CLASS = { sm: 'rounded-sm', md: 'rounded-md', full: 'rounded-full' } as const;

/**
 * Skeleton placeholder.
 *
 * Under `prefers-reduced-motion` the shimmer is not slowed down, it is **removed**: a gentler pulse
 * is still a pulse, and vestibular triggers are about movement rather than speed. The static form
 * is a plain tinted block, which reads perfectly well as "content pending".
 *
 * The whole thing is hidden from assistive technology — announcing a placeholder rectangle is
 * noise. The surrounding region carries `aria-busy` instead.
 */
export function Skeleton({
    heightClassName = 'h-4',
    widthClassName = 'w-full',
    rounded = 'sm',
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
    }, [pulse, reducedMotion]);

    const classes = cx(
        'bg-surface-sunken',
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

    return (
        <Animated.View
            testID={testID}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            aria-hidden
            className={classes}
            style={{ opacity: pulse }}
        />
    );
}
