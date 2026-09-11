import type { ReactNode } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { useDensity } from '../hooks/use-density.tsx';
import type { Density } from '../hooks/use-density.tsx';
import { cx } from '../internal/class-names.ts';

export const CARD_TONES = ['default', 'raised', 'sunken', 'brand', 'warning', 'danger'] as const;
export type CardTone = (typeof CARD_TONES)[number];

const COMFORTABLE_TONE_CLASS: Readonly<Record<CardTone, string>> = {
    default: 'bg-surface-base border-stroke-subtle',
    raised: 'bg-surface-raised border-stroke-subtle shadow-elevation-card',
    sunken: 'bg-surface-sunken border-stroke-subtle',
    brand: 'bg-surface-brand-subtle border-transparent',
    warning: 'bg-warning-subtle border-warning-border',
    danger: 'bg-danger-subtle border-danger-border',
};

/**
 * The admin has two elevations, and a card is the flat one.
 *
 * The handoff allows exactly flat and the popover shadow, so `raised` keeps its lighter fill and
 * loses its cast: on a dense list page a shadow per card is what turns a screen of records into a
 * screen of objects, and the Catalogue's separation comes from the hairline instead.
 */
const COMPACT_TONE_CLASS: Readonly<Record<CardTone, string>> = {
    default: 'bg-surface-base border-stroke-subtle',
    raised: 'bg-surface-raised border-stroke-subtle',
    sunken: 'bg-surface-sunken border-stroke-subtle',
    brand: 'bg-surface-brand-subtle border-transparent',
    warning: 'bg-warning-subtle border-warning-border',
    danger: 'bg-danger-subtle border-danger-border',
};

const TONE_CLASS: Readonly<Record<Density, Readonly<Record<CardTone, string>>>> = {
    comfortable: COMFORTABLE_TONE_CLASS,
    compact: COMPACT_TONE_CLASS,
};

export const CARD_PADDINGS = ['none', 'sm', 'md', 'lg'] as const;
export type CardPadding = (typeof CARD_PADDINGS)[number];

const COMFORTABLE_PADDING_CLASS: Readonly<Record<CardPadding, string>> = {
    none: 'p-0',
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-6',
};

/** The 4-point aliases, so a panel's inset is named rather than counted. */
const COMPACT_PADDING_CLASS: Readonly<Record<CardPadding, string>> = {
    none: 'p-0',
    sm: 'p-tight',
    md: 'p-snug',
    lg: 'p-base',
};

const PADDING_CLASS: Readonly<Record<Density, Readonly<Record<CardPadding, string>>>> = {
    comfortable: COMFORTABLE_PADDING_CLASS,
    compact: COMPACT_PADDING_CLASS,
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
 * `footer` fixes that by changing the box model rather than by appending a row: the card stretches
 * to its grid cell (`self-stretch`), the body takes the slack (`flex-1`), and the footer is pushed
 * down by `mt-auto`. Every footer in a row then lands on one baseline whatever the bodies do.
 *
 * Prefer `self-stretch` over `h-full`. Percentage height against a ScrollView whose content
 * container uses `flex-grow` resolves to the viewport on Yoga (native), so the first footed card
 * grows into infinite white space. Stretch only fills the flex row's cross size when siblings
 * differ — which is the web baseline behaviour we want — without percentage-resolving the scroll
 * content. `CardGridItem` in the application is a flex child of a wrapping row, which stretches by
 * default — but react-native-web gives every `View` `flex-shrink: 0`, and this repository has been
 * caught by that twice already (see the notes in `app-shell.tsx` and `marketplace-shell.tsx`). If
 * footers ever come unpinned, that is the first thing to check, and
 * `apps/universal/e2e/specs/catalogue.ltr.spec.ts` asserts the baseline directly so the failure is
 * loud.
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
    const density = useDensity();
    const hasFooter = footer !== undefined;

    const content = (
        <>
            {title === undefined ? null : (
                <View className="flex-col gap-1">
                    {/* Not `Heading`: level 3 is 20px on the customer ladder and this title has
                        always been 16px there. The role and the level are what matter for the
                        outline; the size follows the density. */}
                    <RNText
                        accessibilityRole="header"
                        aria-level={3}
                        className={cx(
                            'text-content-primary text-start',
                            density === 'compact'
                                ? 'text-role-strong font-admin'
                                : 'text-base font-semibold',
                        )}
                    >
                        {title}
                    </RNText>
                    {subtitle === undefined ? null : (
                        <RNText
                            className={cx(
                                'text-content-secondary text-start',
                                density === 'compact' ? 'text-role-caption font-admin' : 'text-sm',
                            )}
                        >
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
                className={cx('flex-1 flex-col', density === 'compact' ? 'gap-tight' : 'gap-3')}
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
        'flex-col border',
        // 8px panels in the admin (§1.3 — no 14px, no 16px), the customer app's 16px elsewhere.
        density === 'compact' ? 'rounded' : 'rounded-xl',
        // Clipping is what lets media sit flush to the corner instead of a 12px image floating
        // inside a 16px card — but it is scoped to `padding="none"`, which is the only way a card
        // gets edge-to-edge media in the first place. Clipping unconditionally would cut off
        // `Popover`, whose panel is an absolutely positioned sibling rather than a modal; the
        // showcase's own `Section` is a padded card containing exactly that.
        padding === 'none' ? 'overflow-hidden' : null,
        hasFooter ? 'self-stretch' : density === 'compact' ? 'gap-tight' : 'gap-3',
        TONE_CLASS[density][tone],
        PADDING_CLASS[density][padding],
        // The lift is a customer affordance. In the admin `interactive` still marks the card as a
        // target — it takes a hover tint, matching the Catalogue's list rows — but it does not
        // float, because the compact ladder has no second elevation to float to.
        interactive
            ? density === 'compact'
                ? 'transition duration-normal ease-standard hover:bg-surface-sunken'
                : 'transition duration-normal ease-standard hover:-translate-y-1 hover:shadow-elevation-card-hover'
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
