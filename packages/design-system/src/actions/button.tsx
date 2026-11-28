import { Platform, Pressable, Text as RNText, View } from 'react-native';
import type { PressableProps } from 'react-native';
import { useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { useDensity } from '../hooks/use-density.tsx';
import type { Density } from '../hooks/use-density.tsx';
import { cx } from '../internal/class-names.ts';
import { LoadingSweep } from '../motion/loading-sweep.tsx';
import { useAreaLook } from '../hooks/area-look.tsx';
import {
    BUTTON_SIZES,
    BUTTON_VARIANTS,
    CONTAINER_VARIANT,
    DESK_CONTAINER_VARIANT,
    DESK_LABEL_VARIANT,
    LABEL_VARIANT,
} from './button-shared.ts';
import type { ButtonSize, ButtonVariant } from './button-shared.ts';
import { showFloatingLabel } from './floating-label.ts';
import type { FloatingLabel } from './floating-label.ts';

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
 * `controlGap`, corner 8px for every size. Nothing is written as a number and nothing is derived
 * from padding, so "make the admin two pixels tighter" stays one edit in `control.ts`.
 */
const COMPACT_CONTAINER_SIZE: Readonly<Record<ButtonSize, string>> = {
    // The admin canvas draws every button as a pill: 34px in a toolbar or a row, 40 and 44 above that.
    sm: 'h-desk-toolbar px-3 gap-1.5 rounded-full',
    md: 'h-10 px-4 gap-2 rounded-full',
    lg: 'h-11 px-4 gap-2 rounded-full',
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
    sm: 'text-[13px] leading-[18px] !font-semibold',
    md: 'text-[13px] leading-[18px] !font-semibold',
    lg: 'text-[13px] leading-[18px] !font-semibold',
};

const LABEL_SIZE: Readonly<Record<Density, Readonly<Record<ButtonSize, string>>>> = {
    comfortable: COMFORTABLE_LABEL_SIZE,
    compact: COMPACT_LABEL_SIZE,
};

/**
 * The loading sweep's band: light on a filled button, a wash of the brand green on an outlined one —
 * the desk Save's tints, so a busy button reads the same everywhere.
 */
const SWEEP_TINT: Readonly<Record<ButtonVariant, string>> = {
    primary: 'bg-surface-raised opacity-40',
    secondary: 'bg-surface-brand opacity-20',
    quiet: 'bg-surface-brand opacity-20',
    ghost: 'bg-surface-brand opacity-20',
    danger: 'bg-surface-raised opacity-40',
    sidebar: 'bg-surface-raised opacity-40',
    next: 'bg-surface-brand opacity-20',
    dangerOutline: 'bg-danger opacity-20',
    inverse: 'bg-surface-raised opacity-40',
    inverseOutline: 'bg-surface-raised opacity-20',
};

/**
 * The desk's heights and insets, by variant: a toolbar pill (34px) at `sm` and `md`, the 44px pill
 * a panel ends in at `lg`, `next` at 32px so a two-line row stays two lines, and the link-weight
 * `quiet` / `ghost` on the control ladder with the field's 8px corner.
 */
function deskContainerSize(variant: ButtonVariant, size: ButtonSize): string {
    if (size === 'lg') return 'h-11 shrink-0 px-5 rounded-full';
    if (variant === 'quiet' || variant === 'ghost') return 'h-control-sm px-2 rounded';
    if (variant === 'next') return 'h-8 px-3 rounded-full';
    if (variant === 'secondary' || variant === 'dangerOutline' || variant === 'inverseOutline') {
        return 'h-desk-toolbar px-3 rounded-full';
    }
    return 'h-desk-toolbar px-4 rounded-full';
}

/** A filled desk pill that cannot be pressed yet: sunken and grey, not a faded fill. */
const DESK_FILLED: ReadonlySet<ButtonVariant> = new Set(['primary', 'danger']);
const DESK_FILLED_OFF = '!border-stroke-subtle !bg-surface-sunken !shadow-none';

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
    /**
     * One sentence saying what the control is for, beyond its label — "Choose which columns
     * appear in the table" under "Show columns · 6 of 6". On the web it floats under the button
     * while the pointer rests on it, drawn the way `IconButton` draws its name
     * (`floating-label.ts`); everywhere it is the control's `accessibilityHint`, so a screen reader
     * reads it after the label instead of the reader having to hover.
     */
    readonly hint?: string | undefined;
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
    hint,
    className,
    onPress,
    onHoverIn,
    onHoverOut,
    accessibilityLabel,
    accessibilityState,
    testID,
    ...rest
}: ButtonProps) {
    const density = useDensity();
    // Under the admin's look the canvas draws every button (`AreaLookScope look="desk"`).
    const desk = useAreaLook() === 'desk';
    // A loading button is not merely styled as busy — it must not fire again, or a double tap
    // submits the form twice while the first request is still in flight.
    const inert = disabled || loading;
    // Faded white on the sidebar's green reads as a hover state, and its words barely read at all.
    const outlinedWhenInert = disabled && !loading && variant === 'sidebar';
    // A desk primary or danger that cannot be pressed yet is drawn sunken and grey: "not yet" never
    // reads as a faded, broken green.
    const deskFilledOff = desk && disabled && !loading && DESK_FILLED.has(variant);
    const deskInk = deskFilledOff ? 'text-content-disabled' : DESK_LABEL_VARIANT[variant];
    /** On the desk a glyph takes the label's ink unless it names its own. */
    const glyph = (node: ReactNode) =>
        node === undefined || node === null ? null : desk ? (
            <View className={deskInk}>{node}</View>
        ) : (
            node
        );

    const floating = useRef<FloatingLabel | null>(null);
    const hideHint = useCallback(() => {
        floating.current?.hide();
        floating.current = null;
    }, []);
    useEffect(() => hideHint, [hideHint]);

    const showHint = (target: unknown) => {
        if (hint === undefined || Platform.OS !== 'web') return;
        hideHint();
        floating.current = showFloatingLabel(
            target,
            hint,
            testID === undefined ? undefined : `${testID}-hint`,
        );
    };

    const button = (
        <Pressable
            {...rest}
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel ?? label}
            accessibilityState={{ ...accessibilityState, disabled: inert, busy: loading }}
            aria-disabled={inert}
            aria-busy={loading}
            disabled={inert}
            {...(hint === undefined ? {} : { accessibilityHint: hint })}
            onPress={
                inert || onPress === undefined || onPress === null
                    ? undefined
                    : (event) => {
                          hideHint();
                          onPress(event);
                      }
            }
            onHoverIn={(event) => {
                showHint((event as unknown as { currentTarget?: unknown }).currentTarget);
                onHoverIn?.(event);
            }}
            onHoverOut={(event) => {
                hideHint();
                onHoverOut?.(event);
            }}
            className={cx(
                'relative flex-row items-center justify-center',
                loading ? 'overflow-hidden' : null,
                desk
                    ? cx(
                          'gap-1.5 web:transition-colors',
                          DESK_CONTAINER_VARIANT[variant],
                          deskContainerSize(variant, size),
                      )
                    : cx(
                          outlinedWhenInert
                              ? 'border border-content-on-sidebar/60 bg-transparent'
                              : CONTAINER_VARIANT[variant],
                          CONTAINER_SIZE[density][size],
                      ),
                // On the desk a block button shares its row (`flex-1`), except the 44px pill a
                // column ends in, which would squeeze.
                block
                    ? desk && size !== 'lg'
                        ? 'flex-1 self-stretch'
                        : 'self-stretch'
                    : 'self-start',
                // A loading button keeps its full colour: it is busy, not off.
                deskFilledOff
                    ? DESK_FILLED_OFF
                    : disabled && !loading && !outlinedWhenInert
                      ? 'opacity-50'
                      : null,
                className,
            )}
        >
            {/* Behind the label, which stays put: the button keeps its width while busy. */}
            {loading ? (
                <LoadingSweep
                    tint={SWEEP_TINT[variant]}
                    testID={testID === undefined ? undefined : `${testID}-loading`}
                />
            ) : null}
            {glyph(iconStart)}
            <RNText
                // No family class: there is one Latin family, set on `html` per script. This used
                // to add `ADMIN_FONT_CLASS` on the compact branch, which is now an empty string —
                // a concatenation that costs a branch and says nothing.
                className={
                    desk
                        ? cx(
                              size === 'lg' ? 'text-base font-bold' : 'text-role-strong',
                              'text-center',
                              deskInk,
                          )
                        : cx(
                              outlinedWhenInert
                                  ? 'font-semibold text-content-on-sidebar'
                                  : LABEL_VARIANT[variant],
                              LABEL_SIZE[density][size],
                              'text-center',
                          )
                }
                numberOfLines={1}
            >
                {label}
            </RNText>
            {glyph(iconEnd)}
        </Pressable>
    );

    /*
     * A disabled button still says what it is for — and, more usefully, why it cannot be pressed
     * yet — when the pointer rests on it.
     *
     * React Native Web switches hover off on a disabled `Pressable` and gives it
     * `pointer-events: box-none`, so `onHoverIn` never fires on the very buttons whose hint matters
     * most. The pointer then lands on whatever is under the button's box, which is this wrapper:
     * it listens instead, and the button keeps every other disabled behaviour — no press, no focus
     * stop, no hover fill. Web only, and only when there is a hint to show; everywhere else the hint
     * is the `accessibilityHint` either way.
     */
    if (inert && hint !== undefined && Platform.OS === 'web') {
        return (
            <View
                testID={testID === undefined ? undefined : `${testID}-hint-target`}
                className={block ? 'self-stretch' : 'self-start'}
                onPointerEnter={(event) => {
                    showHint(event.currentTarget);
                }}
                onPointerLeave={hideHint}
            >
                {button}
            </View>
        );
    }

    return button;
}

/**
 * `IconButton` moved to its own file, per the handoff's §3 list. It is re-exported here because
 * deep imports of `actions/button.tsx` predate the split and there is no reason to break them.
 */
export { BUTTON_SIZES, BUTTON_VARIANTS };
export type { ButtonSize, ButtonVariant };
export { IconButton } from './icon-button.tsx';
export type { IconButtonProps } from './icon-button.tsx';
