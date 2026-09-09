import { ActivityIndicator, Pressable, Text as RNText } from 'react-native';
import type { PressableProps } from 'react-native';
import type { ReactNode } from 'react';

import { useDensity } from '../hooks/use-density.tsx';
import type { Density } from '../hooks/use-density.tsx';
import { ADMIN_FONT_CLASS } from '../primitives/text.tsx';
import { cx } from '../internal/class-names.ts';
import { BUTTON_SIZES, BUTTON_VARIANTS, CONTAINER_VARIANT, LABEL_VARIANT } from './button-shared.ts';
import type { ButtonSize, ButtonVariant } from './button-shared.ts';

/**
 * Button.
 *
 * The leading/trailing slots are named `iconStart` / `iconEnd`, not left/right, and they are placed
 * by *source order* inside a `flex-row`. Flexbox rows follow the writing direction, so a start slot
 * ends up on the right in Arabic without a single mirrored style — which is the only mirroring
 * technique that survives a live `dir` flip on the web (notes/nativewind-spike.md §4).
 *
 * ## Size is a ladder, and which ladder depends on density
 *
 * Under `compact` — the kitchen admin — `sm`/`md`/`lg` are `controlHeight`'s 28/32/36px and nothing
 * else: no padding-driven height, no `min-h-touch`, no per-size radius. Under `comfortable` — the
 * customer app, and the default — they keep the 44px floor the phone surfaces are held to. See
 * `hooks/use-density.tsx` for why one prop cannot mean both.
 */

/*
 * One corner for every button.
 *
 * `sm` was `rounded-md` (8px) against `rounded-lg` (12px) on the others, so a toolbar of mixed
 * sizes had two different corners in one row. The design uses a single radius across its whole
 * button family — 9px on the account control, 10px on the basket and on the hero call to action —
 * and reads as one system because of it. 12px is the token nearest that cluster.
 *
 * Padding is more generous than it was at `sm` and `md`: the design's buttons sit at 9–10px
 * vertical, where these were at 6–8px, which is what made the old toolbar feel cramped next to a
 * 44px field.
 */
const COMFORTABLE_CONTAINER_SIZE: Readonly<Record<ButtonSize, string>> = {
    sm: 'min-h-touch px-3.5 py-2 rounded-lg gap-1.5',
    md: 'min-h-touch px-4 py-2.5 rounded-lg gap-2',
    lg: 'min-h-touch px-6 py-3.5 rounded-lg gap-2',
};

/*
 * The admin ladder: height from `controlHeight`, inset from `controlPaddingX`, gap from
 * `controlGap`, corner 4px for every size. Nothing is written as a number and nothing is derived
 * from padding, so "make the admin two pixels tighter" stays one edit in `control.ts`.
 */
const COMPACT_CONTAINER_SIZE: Readonly<Record<ButtonSize, string>> = {
    sm: 'h-control-sm px-control-sm gap-control-sm rounded-sm',
    md: 'h-control-md px-control-md gap-control-md rounded-sm',
    lg: 'h-control-lg px-control-lg gap-control-lg rounded-sm',
};

const CONTAINER_SIZE: Readonly<Record<Density, Readonly<Record<ButtonSize, string>>>> = {
    comfortable: COMFORTABLE_CONTAINER_SIZE,
    compact: COMPACT_CONTAINER_SIZE,
};

/*
 * `lg` is 16px, not 18px. The largest button the design draws — the hero call to action — sets its
 * label at 15px, which snaps to `text-base`; `text-lg` overshot it by a step and made a primary CTA
 * compete with the headline above it.
 */
const COMFORTABLE_LABEL_SIZE: Readonly<Record<ButtonSize, string>> = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-base',
};

/*
 * One label size across the admin ladder — `role-label`, the ramp's 12/16 500. A 28px and a 36px
 * button in the same toolbar are the same control at two emphases, not two type sizes; the ramp
 * gives the size and the variant gives the weight, so the two never disagree.
 */
const COMPACT_LABEL_SIZE: Readonly<Record<ButtonSize, string>> = {
    sm: 'text-role-label',
    md: 'text-role-label',
    lg: 'text-role-label',
};

const LABEL_SIZE: Readonly<Record<Density, Readonly<Record<ButtonSize, string>>>> = {
    comfortable: COMFORTABLE_LABEL_SIZE,
    compact: COMPACT_LABEL_SIZE,
};

/**
 * The spinner cannot inherit `currentColor` through `ActivityIndicator`, so the colour is repeated
 * here — and it is repeated as a literal because this is a prop, not a class name.
 *
 * These were `#4e8a37`, an olive that belongs to no palette this product has ever shipped; against
 * the wellness green it read as a different brand mid-request. They are `brand-surface` now.
 */
const SPINNER_COLOUR: Readonly<Record<ButtonVariant, string>> = {
    primary: '#ffffff',
    secondary: '#157043',
    quiet: '#5b6673',
    ghost: '#157043',
    danger: '#ffffff',
};

export interface ButtonProps extends Omit<
    PressableProps,
    'children' | 'className' | 'style' | 'disabled'
> {
    readonly label: string;
    readonly variant?: ButtonVariant | undefined;
    readonly size?: ButtonSize | undefined;
    readonly loading?: boolean | undefined;
    readonly disabled?: boolean | undefined;
    /** Rendered on the leading edge — left in English, right in Arabic. */
    readonly iconStart?: ReactNode | undefined;
    /** Rendered on the trailing edge. */
    readonly iconEnd?: ReactNode | undefined;
    /** Stretch to the container width. */
    readonly block?: boolean | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

export function Button({
    label,
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled = false,
    iconStart,
    iconEnd,
    block = false,
    className,
    onPress,
    accessibilityLabel,
    testID,
    ...rest
}: ButtonProps) {
    const density = useDensity();
    // A loading button is not merely styled as busy — it must not fire again, or a double tap
    // submits the form twice while the first request is still in flight.
    const inert = disabled || loading;

    return (
        <Pressable
            {...rest}
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel ?? label}
            accessibilityState={{ disabled: inert, busy: loading }}
            aria-disabled={inert}
            aria-busy={loading}
            disabled={inert}
            onPress={inert ? undefined : onPress}
            className={cx(
                'flex-row items-center justify-center',
                CONTAINER_VARIANT[variant],
                CONTAINER_SIZE[density][size],
                block ? 'self-stretch' : 'self-start',
                inert ? 'opacity-50' : null,
                className,
            )}
        >
            {loading ? (
                // Hidden from assistive technology: the button itself already announces
                // `aria-busy`, and an unnamed nested progressbar is an axe serious violation.
                <ActivityIndicator
                    testID={testID === undefined ? undefined : `${testID}-spinner`}
                    size="small"
                    color={SPINNER_COLOUR[variant]}
                    accessibilityElementsHidden
                    aria-hidden
                />
            ) : (
                iconStart
            )}
            <RNText
                className={cx(
                    LABEL_VARIANT[variant],
                    LABEL_SIZE[density][size],
                    density === 'compact' ? ADMIN_FONT_CLASS : null,
                    'text-center',
                )}
                numberOfLines={1}
            >
                {label}
            </RNText>
            {iconEnd}
        </Pressable>
    );
}

/**
 * `IconButton` moved to its own file, per the handoff's §3 list. It is re-exported here because
 * deep imports of `actions/button.tsx` predate the split and there is no reason to break them.
 */
export { BUTTON_SIZES, BUTTON_VARIANTS };
export type { ButtonSize, ButtonVariant };
export { IconButton } from './icon-button.tsx';
export type { IconButtonProps } from './icon-button.tsx';
