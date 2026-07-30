import type { ReactNode } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { cx } from '../internal/class-names.ts';

export const CARD_TONES = ['default', 'raised', 'sunken', 'brand', 'danger'] as const;
export type CardTone = (typeof CARD_TONES)[number];

const TONE_CLASS: Readonly<Record<CardTone, string>> = {
    default: 'bg-surface-base border-stroke-subtle',
    raised: 'bg-surface-raised border-stroke-subtle shadow-elevation-1',
    sunken: 'bg-surface-sunken border-stroke-subtle',
    brand: 'bg-surface-brand-subtle border-transparent',
    danger: 'bg-danger-subtle border-danger-border',
};

export const CARD_PADDINGS = ['none', 'sm', 'md', 'lg'] as const;
export type CardPadding = (typeof CARD_PADDINGS)[number];

const PADDING_CLASS: Readonly<Record<CardPadding, string>> = {
    none: 'p-0',
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-6',
};

export interface CardProps {
    readonly children: ReactNode;
    readonly title?: string | undefined;
    readonly subtitle?: string | undefined;
    readonly tone?: CardTone | undefined;
    readonly padding?: CardPadding | undefined;
    /** Makes the whole card activatable. Supply `accessibilityLabel` when the title is not enough. */
    readonly onPress?: (() => void) | undefined;
    readonly accessibilityLabel?: string | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Card.
 *
 * A pressable card becomes a real `button` rather than a `div` with an `onClick`, so it is reachable
 * by keyboard and announced as actionable. A non-pressable card stays a plain grouping element with
 * no role at all — giving decorative containers a role is how an accessibility tree turns to noise.
 */
export function Card({
    children,
    title,
    subtitle,
    tone = 'raised',
    padding = 'md',
    onPress,
    accessibilityLabel,
    className,
    testID,
}: CardProps) {
    const body = (
        <>
            {title === undefined ? null : (
                <View className="flex-col gap-1">
                    <RNText
                        accessibilityRole="header"
                        aria-level={3}
                        className="text-base font-semibold text-content-primary text-start"
                    >
                        {title}
                    </RNText>
                    {subtitle === undefined ? null : (
                        <RNText className="text-sm text-content-secondary text-start">
                            {subtitle}
                        </RNText>
                    )}
                </View>
            )}
            {children}
        </>
    );

    const classes = cx(
        'flex-col gap-3 rounded-xl border',
        TONE_CLASS[tone],
        PADDING_CLASS[padding],
        className,
    );

    if (onPress === undefined) {
        return (
            <View testID={testID} className={classes}>
                {body}
            </View>
        );
    }

    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel ?? title}
            focusable
            onPress={onPress}
            className={classes}
        >
            {body}
        </Pressable>
    );
}
