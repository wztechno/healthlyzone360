import { cx } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

/**
 * The small pieces of HealthZone's control vocabulary the plan screens draw and the design system
 * does not have in the design's shape. Feature-local on purpose: each is a candidate for a shared
 * component (see the report that introduced them), and until one exists they live beside the only
 * screens that use them rather than being invented twice.
 *
 * The design's `chip()` is not here: it is the shared `PillChip` (`ui/pill-chip.tsx`).
 *
 * ## Why not `Badge`, `Callout`
 *
 * - The design's `badge()` is a bordered tone pill with an uppercase label and no mark; `Badge`
 *   draws a dot (pill) or a glyph (label).
 * - The design's info notes are one plain sentence in a tinted box; `Callout` always has a title.
 */

/* ── badge() ─────────────────────────────────────────────────────────────────────────────────── */

export type StatePillTone = 'success' | 'warning' | 'info' | 'danger' | 'brand';

const PILL_FRAME: Readonly<Record<StatePillTone, string>> = {
    success: 'border border-success-border bg-success-subtle',
    warning: 'border border-warning-border bg-warning-subtle',
    info: 'border border-info-border bg-info-subtle',
    danger: 'border border-danger-border bg-danger-subtle',
    // The design's "CURRENT" mark: the brand-subtle fill with no border of its own.
    brand: 'border border-transparent bg-surface-brand-subtle',
};

const PILL_TEXT: Readonly<Record<StatePillTone, string>> = {
    success: 'text-success-on-subtle',
    warning: 'text-warning-on-subtle',
    info: 'text-info-on-subtle',
    danger: 'text-danger-on-subtle',
    brand: 'text-content-on-brand-subtle',
};

export function StatePill({
    label,
    tone,
    className,
    testID,
}: {
    readonly label: string;
    readonly tone: StatePillTone;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}) {
    return (
        <View
            testID={testID}
            className={cx('items-center rounded-full px-2.5 py-0.5', PILL_FRAME[tone], className)}
        >
            <RNText
                numberOfLines={1}
                className={cx('text-xs font-medium uppercase tracking-wide', PILL_TEXT[tone])}
            >
                {label}
            </RNText>
        </View>
    );
}

/* ── the info note ───────────────────────────────────────────────────────────────────────────── */

export function InfoNote({
    children,
    testID,
    className,
}: {
    readonly children: string;
    readonly testID?: string | undefined;
    readonly className?: string | undefined;
}) {
    return (
        <View
            testID={testID}
            role="note"
            className={cx(
                'rounded-lg border border-info-border bg-info-subtle px-4 py-3',
                className,
            )}
        >
            <RNText className="text-sm leading-relaxed text-info-on-subtle text-start">
                {children}
            </RNText>
        </View>
    );
}

/* ── the line-soft button ────────────────────────────────────────────────────────────────────── */

/**
 * The design's quiet filled button — "Manage plan", "Shuffle my week": the soft line colour as a
 * fill, ink text, no border. No `Button` variant draws it (`quiet` is outlined), and a caller's
 * class cannot reliably outrank a variant's fill, so it is its own small control.
 */
export function SubtleButton({
    label,
    onPress,
    block = false,
    size = 'md',
    accessibilityLabel,
    testID,
}: {
    readonly label: string;
    readonly onPress: () => void;
    readonly block?: boolean | undefined;
    readonly size?: 'md' | 'lg' | undefined;
    readonly accessibilityLabel?: string | undefined;
    readonly testID?: string | undefined;
}) {
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel ?? label}
            onPress={onPress}
            className={cx(
                'flex-row items-center justify-center rounded-lg bg-stroke-subtle hover:bg-surface-sunken',
                // `lg` matches `Button`'s lg height (14px inset around a 24px line) without the
                // 3.5 step the spacing scale does not carry.
                size === 'lg' ? 'min-h-[52px] px-6 py-3' : 'min-h-touch px-4 py-2.5',
                block ? 'self-stretch' : 'self-start',
            )}
        >
            <RNText
                numberOfLines={1}
                className={cx(
                    'font-semibold text-content-primary text-center',
                    size === 'lg' ? 'text-base' : 'text-sm',
                )}
            >
                {label}
            </RNText>
        </Pressable>
    );
}

/* ── the inline text link ────────────────────────────────────────────────────────────────────── */

/** "How plans work →": the design's accent-deep inline link, with the customer 44px target. */
export function TextLink({
    label,
    onPress,
    testID,
}: {
    readonly label: string;
    readonly onPress: () => void;
    readonly testID?: string | undefined;
}) {
    return (
        <Pressable
            testID={testID}
            role="link"
            accessibilityRole="link"
            accessibilityLabel={label}
            onPress={onPress}
            className="min-h-touch justify-center self-start"
        >
            <RNText className="text-sm font-semibold text-content-on-brand-subtle text-start hover:underline">
                {label}
            </RNText>
        </Pressable>
    );
}

/** A labelled card in the plan screens' shape: the raised surface inside the default hairline. */
export function PlanPanel({
    children,
    testID,
    className,
    nativeID,
}: {
    readonly children: ReactNode;
    readonly testID?: string | undefined;
    readonly className?: string | undefined;
    readonly nativeID?: string | undefined;
}) {
    return (
        <View
            testID={testID}
            nativeID={nativeID}
            className={cx('rounded-xl border border-stroke bg-surface-raised', className)}
        >
            {children}
        </View>
    );
}
