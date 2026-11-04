import { cx, useMotion } from '@healthy360/design-system';
import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, Pressable, Text as RNText, View } from 'react-native';

/**
 * The board's back pill: a soft pill with a bold chevron in a raised circle. On hover the pill turns
 * the brand's soft green and the chevron steps back 3px — towards the start, so to the right in
 * Arabic — on the board's easing.
 */
export function BackPill({
    label,
    onPress,
    testID = 'meal-detail-back',
    className,
}: {
    readonly label: string;
    readonly onPress: () => void;
    readonly testID?: string | undefined;
    readonly className?: string | undefined;
}) {
    const { enabled, axisSign } = useMotion();
    const [hovered, setHovered] = useState(false);
    const [nudge] = useState(() => new Animated.Value(0));

    useEffect(() => {
        const to = hovered ? -3 * axisSign : 0;
        if (!enabled) {
            nudge.setValue(to);
            return undefined;
        }
        const animation = Animated.timing(nudge, {
            toValue: to,
            duration: 250,
            easing: Easing.bezier(0.22, 1, 0.36, 1),
            useNativeDriver: Platform.OS !== 'web',
        });
        animation.start();
        return () => {
            animation.stop();
        };
    }, [axisSign, enabled, hovered, nudge]);

    return (
        <Pressable
            testID={testID}
            role="link"
            accessibilityRole="link"
            onPress={onPress}
            onHoverIn={() => {
                setHovered(true);
            }}
            onHoverOut={() => {
                setHovered(false);
            }}
            onFocus={() => {
                setHovered(true);
            }}
            onBlur={() => {
                setHovered(false);
            }}
            className={cx(
                'h-11 flex-row items-center gap-2.5 self-start rounded-full border pe-4 ps-1.5 transition duration-normal ease-standard',
                className,
                hovered
                    ? 'border-stroke bg-surface-brand-subtle'
                    : 'border-stroke-subtle bg-surface-base',
            )}
        >
            <Animated.View
                className="h-8 w-8 items-center justify-center rounded-full bg-surface-raised shadow-elevation-2"
                style={{ transform: [{ translateX: nudge }] }}
            >
                {/* The board's 2.6 stroke chevron: two borders of a small square, turned to point
                    towards the start. In Arabic the start is the right, so it turns the other way. */}
                <View
                    aria-hidden
                    className="ms-1 h-2 w-2 border-b-[2.5px] border-s-[2.5px] border-surface-brand"
                    style={{ transform: [{ rotate: `${String(45 * axisSign)}deg` }] }}
                />
            </Animated.View>
            <RNText className="text-sm font-semibold text-content-primary">{label}</RNText>
        </Pressable>
    );
}
