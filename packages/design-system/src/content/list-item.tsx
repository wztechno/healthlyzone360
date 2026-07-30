import type { ReactNode } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { descriptionProps } from '../internal/a11y.ts';

export interface ListItemProps {
    readonly title: string;
    readonly description?: string | undefined;
    /** Leading slot — avatar, status dot, icon. Placed on the leading edge by flex source order. */
    readonly leading?: ReactNode | undefined;
    /** Trailing slot — badge, metadata, control. */
    readonly trailing?: ReactNode | undefined;
    /** Draw the direction-aware chevron. Only meaningful when the row navigates somewhere. */
    readonly chevron?: boolean | undefined;
    readonly onPress?: (() => void) | undefined;
    readonly disabled?: boolean | undefined;
    readonly selected?: boolean | undefined;
    readonly accessibilityLabel?: string | undefined;
    readonly accessibilityHint?: string | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * List item.
 *
 * The chevron uses `chevronEnd`, which resolves to `›` in English and `‹` in Arabic by picking a
 * different character rather than by mirroring a style. That is deliberate: the NativeWind spike
 * showed inline logical style props do not re-mirror on a live web `dir` change, whereas a
 * re-render with a different glyph always does (notes/nativewind-spike.md §4).
 */
export function ListItem({
    title,
    description,
    leading,
    trailing,
    chevron = false,
    onPress,
    disabled = false,
    selected = false,
    accessibilityLabel,
    accessibilityHint,
    className,
    testID,
}: ListItemProps) {
    const content = (
        <>
            {leading === undefined ? null : (
                <View testID={testID === undefined ? undefined : `${testID}-leading`}>
                    {leading}
                </View>
            )}

            <View className="flex-1 flex-col gap-0.5">
                <RNText
                    testID={testID === undefined ? undefined : `${testID}-title`}
                    className={cx(
                        'text-base text-start',
                        disabled ? 'text-content-disabled' : 'text-content-primary',
                    )}
                >
                    {title}
                </RNText>
                {description === undefined ? null : (
                    <RNText className="text-sm text-content-secondary text-start">
                        {description}
                    </RNText>
                )}
            </View>

            {trailing === undefined ? null : (
                <View testID={testID === undefined ? undefined : `${testID}-trailing`}>
                    {trailing}
                </View>
            )}

            {chevron ? (
                <Icon
                    testID={testID === undefined ? undefined : `${testID}-chevron`}
                    name="chevronEnd"
                    className="text-content-secondary"
                />
            ) : null}
        </>
    );

    const classes = cx(
        'flex-row items-center gap-3 rounded-lg px-3 py-3 min-h-touch',
        selected ? 'bg-surface-brand-subtle' : 'bg-transparent',
        disabled ? 'opacity-50' : null,
        className,
    );

    if (onPress === undefined) {
        return (
            <View testID={testID} className={classes}>
                {content}
            </View>
        );
    }

    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel ?? title}
            accessibilityState={{ disabled, selected }}
            aria-disabled={disabled}
            {...descriptionProps([], accessibilityHint)}
            focusable={!disabled}
            disabled={disabled}
            onPress={onPress}
            className={classes}
        >
            {content}
        </Pressable>
    );
}
