import { Pressable, Text as RNText, View } from 'react-native';
import type { PressableProps } from 'react-native';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { useDensity } from '../hooks/use-density.tsx';
import type { Density } from '../hooks/use-density.tsx';
import { cx } from '../internal/class-names.ts';
import { CONTAINER_VARIANT, LABEL_VARIANT } from './button-shared.ts';
import type { ButtonSize, ButtonVariant } from './button-shared.ts';

/**
 * Icon button — a control whose whole content is a glyph.
 *
 * It shares `Button`'s variants and its size ladder, because it is the same control with its label
 * removed: a `ghost` icon button in a toolbar has to read as the same weight as the `ghost` text
 * button beside it, and the two drifting apart is what makes a dense row look assembled rather than
 * designed.
 *
 * **Square comes from `aspect-square`, not from a width token.** The height is the ladder's, and
 * the aspect ratio makes the box follow it, so a 28px control is 28×28 without this file ever
 * naming a number — which is also the only way to keep the "no component sets a width" rule while
 * still being square.
 */

export interface IconButtonProps extends Omit<
    PressableProps,
    'children' | 'className' | 'style' | 'disabled' | 'aria-label'
> {
    /** Required: an icon-only control has no visible text, so this *is* its accessible name. */
    readonly label: string;
    readonly icon: ReactNode;
    readonly variant?: ButtonVariant | undefined;
    /**
     * Recolours the *glyph* without changing the container — a destructive action drawn flat.
     *
     * Distinct from `variant="danger"`, which is the filled destructive button. A row's Archive
     * control is one of three icons sitting on the row itself: a filled red square repeated down
     * twenty-five rows reads as an error state, and dropping the signal altogether leaves a
     * one-click destructive action looking exactly like the two beside it. `MenuItem` draws the
     * same distinction with the same word.
     */
    readonly tone?: 'default' | 'danger' | undefined;
    readonly size?: ButtonSize | undefined;
    readonly disabled?: boolean | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

const COMFORTABLE_SIZE: Readonly<Record<ButtonSize, string>> = {
    sm: 'min-h-touch min-w-touch rounded-md',
    md: 'min-h-touch min-w-touch rounded-lg',
    lg: 'min-h-touch min-w-touch rounded-lg p-2',
};

const COMPACT_SIZE: Readonly<Record<ButtonSize, string>> = {
    sm: 'h-control-sm aspect-square rounded-sm',
    md: 'h-control-md aspect-square rounded-sm',
    lg: 'h-control-lg aspect-square rounded-sm',
};

const ICON_BUTTON_SIZE: Readonly<Record<Density, Readonly<Record<ButtonSize, string>>>> = {
    comfortable: COMFORTABLE_SIZE,
    compact: COMPACT_SIZE,
};

/** `null` leaves the variant's own ink alone, which is what `default` means. */
const TONE_CLASS: Readonly<Record<'default' | 'danger', string | null>> = {
    default: null,
    danger: 'text-danger-strong',
};

export function IconButton({
    label,
    icon,
    variant = 'ghost',
    tone = 'default',
    size = 'md',
    disabled = false,
    className,
    onPress,
    onHoverIn,
    onHoverOut,
    testID,
    ...rest
}: IconButtonProps) {
    const density = useDensity();

    /*
     * The label, drawn while the pointer rests on the glyph.
     *
     * An icon-only control's name is `aria-label` for a screen reader and nothing for a mouse: a
     * row of four glyphs asks the reader to guess. Hover is the mouse's own way of asking, so the
     * label sits above the glyph for as long as the pointer stays. Above rather than below, because
     * react-native-web paints siblings in source order and a label hanging *under* a table row would
     * be covered by the row after it. Native never fires hover, so nothing changes there.
     */
    const [hovered, setHovered] = useState(false);
    const showLabel = hovered && !disabled;

    return (
        <Pressable
            {...rest}
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={label}
            aria-label={label}
            accessibilityState={{ disabled }}
            aria-disabled={disabled}
            disabled={disabled}
            onPress={disabled ? undefined : onPress}
            onHoverIn={(event) => {
                setHovered(true);
                onHoverIn?.(event);
            }}
            onHoverOut={(event) => {
                setHovered(false);
                onHoverOut?.(event);
            }}
            className={cx(
                'relative items-center justify-center',
                CONTAINER_VARIANT[variant],
                ICON_BUTTON_SIZE[density][size],
                disabled ? 'opacity-50' : null,
                className,
            )}
        >
            <View className={cx(LABEL_VARIANT[variant], TONE_CLASS[tone])}>{icon}</View>
            {showLabel ? (
                <View
                    testID={testID === undefined ? undefined : `${testID}-hover-label`}
                    // Never a pointer target of its own: it would flicker the moment it was
                    // reached, and it says nothing a screen reader has not already been told.
                    style={{ pointerEvents: 'none' }}
                    aria-hidden
                    className="absolute bottom-full end-0 z-tooltip mb-1 rounded-sm bg-surface-canopy-deep px-2 py-1"
                >
                    <RNText numberOfLines={1} className="text-role-caption text-content-on-canopy">
                        {label}
                    </RNText>
                </View>
            ) : null}
        </Pressable>
    );
}
