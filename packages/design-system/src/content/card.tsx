import type { ReactNode } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { cx } from '../internal/class-names.ts';

export const CARD_TONES = ['default', 'raised', 'sunken', 'brand', 'danger'] as const;
export type CardTone = (typeof CARD_TONES)[number];

const TONE_CLASS: Readonly<Record<CardTone, string>> = {
    default: 'bg-surface-base border-stroke-subtle',
    raised: 'bg-surface-raised border-stroke-subtle shadow-elevation-card',
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
    /**
     * Pinned to the bottom of the card. See the note below on why this changes the card's whole
     * box model rather than just appending a row.
     */
    readonly footer?: ReactNode | undefined;
    /**
     * Hover lift, for a card that is a *single* target. Only meaningful with `onPress`, and
     * deliberately not implied by it — see the warning below.
     */
    readonly interactive?: boolean | undefined;
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
 *
 * ## The footer is what makes a grid of cards readable
 *
 * Without it, every card is as tall as its own content, so the price — the one figure a shopper
 * compares across a row — sits at a different height in each card and the eye has to hunt for it.
 * `footer` fixes that by changing the box model rather than by appending a row: the card fills its
 * grid cell (`h-full`), the body takes the slack (`flex-1`), and the footer is pushed down by
 * `mt-auto`. Every footer in a row then lands on one baseline whatever the bodies do.
 *
 * That only works if the cell stretches. `CardGridItem` in the application is a flex child of a
 * wrapping row, which stretches by default — but react-native-web gives every `View`
 * `flex-shrink: 0`, and this repository has been caught by that twice already (see the notes in
 * `app-shell.tsx` and `marketplace-shell.tsx`). If footers ever come unpinned, that is the first
 * thing to check, and `apps/universal/e2e/specs/catalogue.ltr.spec.ts` asserts the baseline
 * directly so the failure is loud.
 *
 * The root gap is dropped when a footer is present: `gap-3` between siblings plus `mt-auto` on the
 * last one would add the gap *and* the free space, leaving a card whose footer is one step further
 * from the body than the design says. Spacing then belongs to the body and footer wrappers, which
 * is also what lets media sit flush to the card edge while the text keeps its inset.
 *
 * ## `interactive` is opt-in, and not every pressable card gets it
 *
 * `plan-card.tsx` documents at length why a plan card is deliberately *not* one big pressable
 * target: it carries a comparison checkbox, a duration picker and an open action, and a checkbox
 * inside a button is unreachable by keyboard and ambiguous on touch. Single-target cards — meal,
 * kitchen, dietitian — take `interactive`; a card with controls inside it puts its hover affordance
 * on the control instead. Tying the lift to `onPress` would have removed that choice.
 *
 * The transition runs off the duration tokens rather than a literal, because those are what
 * `prefers-reduced-motion` zeroes — a hard-coded `.18s` would keep animating for a reader who
 * asked it not to.
 */
export function Card({
    children,
    title,
    subtitle,
    tone = 'raised',
    padding = 'md',
    footer,
    interactive = false,
    onPress,
    accessibilityLabel,
    className,
    testID,
}: CardProps) {
    const hasFooter = footer !== undefined;

    const content = (
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

    const body = hasFooter ? (
        <>
            <View
                testID={testID === undefined ? undefined : `${testID}-body`}
                className="flex-1 flex-col gap-3"
            >
                {content}
            </View>
            <View
                testID={testID === undefined ? undefined : `${testID}-footer`}
                className="mt-auto flex-col"
            >
                {footer}
            </View>
        </>
    ) : (
        content
    );

    const classes = cx(
        'flex-col rounded-xl border',
        // Clipping is what lets media sit flush to the corner instead of a 12px image floating
        // inside a 16px card — but it is scoped to `padding="none"`, which is the only way a card
        // gets edge-to-edge media in the first place. Clipping unconditionally would cut off
        // `Popover`, whose panel is an absolutely positioned sibling rather than a modal; the
        // showcase's own `Section` is a padded card containing exactly that.
        padding === 'none' ? 'overflow-hidden' : null,
        hasFooter ? 'h-full' : 'gap-3',
        TONE_CLASS[tone],
        PADDING_CLASS[padding],
        interactive
            ? 'transition duration-normal ease-standard hover:-translate-y-1 hover:shadow-elevation-card-hover'
            : null,
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
