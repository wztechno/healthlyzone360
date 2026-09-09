import type { ReactNode } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { useBreakpoint } from '../hooks/use-breakpoint.ts';
import { useDensity } from '../hooks/use-density.tsx';
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
    /**
     * A run of secondary values — category, unit, reference. Shown on the second line under `md`,
     * where the column grid has collapsed and the meta is what is left of it.
     *
     * Separated visually by the caller, not joined into one string here: a `·` welded into a
     * translated string is a `·` a right-to-left catalogue cannot reposition.
     */
    readonly meta?: ReactNode | undefined;
    /** The entity's headline number. Mono, and the last thing dropped as the row narrows. */
    readonly metric?: ReactNode | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * List item.
 *
 * ## Two lines below `md`, one row above it
 *
 * The Catalogue's list is a column grid at `lg` and wider, and `DataList` draws it. Below `md`
 * there is no room for tracks, so the same record renders here as two lines — title and status,
 * then the meta run, the metric and the overflow — rather than as a grid that scrolls sideways
 * (§4.1). The break is a *structural* difference, so it branches in JavaScript on `useBreakpoint`
 * rather than in class variants: the one-line and two-line trees have different element counts, and
 * rendering both to hide one would put a duplicate of every row in the accessibility tree.
 *
 * The 44px floor holds on the comfortable ladder and is dropped on the compact one. That is not an
 * inconsistency — it is `use-density.tsx`'s whole argument. A customer-app list row is a phone
 * target; a Catalogue row is a 32px line on a desk surface driven with a mouse.
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
    meta,
    metric,
    className,
    testID,
}: ListItemProps) {
    const density = useDensity();
    const { atLeast } = useBreakpoint();
    const compact = density === 'compact';
    // `md` is the boundary the handoff names, and it is read once here rather than at each slot so
    // the row cannot end up half-collapsed — a two-line title beside a one-line trailing column.
    const stacked = compact && !atLeast('md');

    const titleClass = compact
        ? cx(
              'text-role-strong font-admin text-start',
              disabled ? 'text-content-disabled' : 'text-content-primary',
          )
        : cx(
              'text-base text-start',
              disabled ? 'text-content-disabled' : 'text-content-primary',
          );

    const descriptionClass = compact
        ? 'text-role-caption font-admin text-content-secondary text-start'
        : 'text-sm text-content-secondary text-start';

    const content = (
        <>
            {leading === undefined ? null : (
                <View testID={testID === undefined ? undefined : `${testID}-leading`}>
                    {leading}
                </View>
            )}

            {/*
             * `flex-1` on the title column, and it is the one place the no-stretch rule does not
             * apply: this *is* the row. §2 grants the exception by name — a row's title column and a
             * toolbar spacer — because the thing being filled is the line itself rather than a
             * control that has a width of its own.
             */}
            <View className="flex-1 flex-col gap-0.5">
                <View className="flex-row items-center gap-tight">
                    <RNText
                        testID={testID === undefined ? undefined : `${testID}-title`}
                        numberOfLines={stacked ? 2 : 1}
                        className={cx('flex-1', titleClass)}
                    >
                        {title}
                    </RNText>
                    {/*
                     * Stacked, the status badge rides up onto the title line. It is the second most
                     * important thing in the row and the only one that must not wrap below the
                     * fold — a draft record that reads as live is the failure this ordering avoids.
                     */}
                    {stacked && trailing !== undefined ? (
                        <View testID={testID === undefined ? undefined : `${testID}-trailing`}>
                            {trailing}
                        </View>
                    ) : null}
                </View>

                {description === undefined ? null : (
                    <RNText className={descriptionClass}>{description}</RNText>
                )}

                {stacked && (meta !== undefined || metric !== undefined) ? (
                    <View
                        testID={testID === undefined ? undefined : `${testID}-meta`}
                        className="flex-row items-center justify-between gap-tight"
                    >
                        <View className="flex-1 flex-row items-center gap-tight">{meta}</View>
                        {metric}
                    </View>
                ) : null}
            </View>

            {!stacked && meta !== undefined ? (
                <View
                    testID={testID === undefined ? undefined : `${testID}-meta`}
                    className="flex-row items-center gap-tight"
                >
                    {meta}
                </View>
            ) : null}

            {!stacked && metric !== undefined ? metric : null}

            {!stacked && trailing !== undefined ? (
                <View testID={testID === undefined ? undefined : `${testID}-trailing`}>
                    {trailing}
                </View>
            ) : null}

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
        'flex-row gap-3',
        compact
            ? // No `min-h-touch`, no card corner and no vertical padding worth the name: a compact
              // row is a line in a list, and its height comes from `rowHeight` through the class
              // below. Stacked, it has two lines of content, so the height is content-driven and
              // only the inset is stated.
              cx(
                  'items-center border-b border-stroke-subtle px-control-sm',
                  stacked ? 'py-tight' : 'h-row-md',
              )
            : 'items-center rounded-lg px-3 py-3 min-h-touch',
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
