import { NUTRITION_LEVELS } from '@healthy360/design-tokens';
import type { NutritionLevel } from '@healthy360/design-tokens';
import { Text as RNText, View } from 'react-native';

import { useDensity } from '../hooks/use-density.tsx';
import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import {
    NUTRITION_ON_CLASS,
    NUTRITION_SURFACE_CLASS,
    nutritionMark,
} from '../internal/nutrition.ts';

export const BADGE_TONES = ['neutral', 'success', 'warning', 'danger', 'info', 'brand'] as const;
export type BadgeTone = (typeof BADGE_TONES)[number];

export const BADGE_VARIANTS = ['pill', 'label', 'caps'] as const;
export type BadgeVariant = (typeof BADGE_VARIANTS)[number];

/** The mark on a `label`: the tone's strong ink, so the glyph carries the tone at 10px. */
const TONE_MARK_CLASS: Readonly<Record<BadgeTone, string>> = {
    neutral: 'text-content-secondary',
    success: 'text-success-strong',
    warning: 'text-warning-strong',
    danger: 'text-danger-strong',
    info: 'text-info-strong',
    brand: 'text-content-on-brand-subtle',
};

/** The fill of a `label` or `caps`: the subtle surface alone, no border. */
const TONE_FILL_CLASS: Readonly<Record<BadgeTone, string>> = {
    neutral: 'bg-surface-sunken',
    success: 'bg-success-subtle',
    warning: 'bg-warning-subtle',
    danger: 'bg-danger-subtle',
    info: 'bg-info-subtle',
    brand: 'bg-surface-brand-subtle',
};

/**
 * The dot on a `pill`, and the ink of a mark drawn in its place: the tone's `DEFAULT`, the
 * saturated middle of its ramp. It is a non-text mark on the subtle fill, so it answers to the 3:1
 * target rather than to text contrast, and the fuller ink is what lets six pixels read as a colour.
 */
const TONE_DOT_CLASS: Readonly<Record<BadgeTone, string>> = {
    neutral: 'bg-content-secondary',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
    info: 'bg-info',
    brand: 'bg-content-on-brand-subtle',
};

const TONE_DOT_INK_CLASS: Readonly<Record<BadgeTone, string>> = {
    neutral: 'text-content-secondary',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
    info: 'text-info',
    brand: 'text-content-on-brand-subtle',
};

const TONE_TEXT_CLASS: Readonly<Record<BadgeTone, string>> = {
    neutral: 'text-content-secondary',
    success: 'text-success-on-subtle',
    warning: 'text-warning-on-subtle',
    danger: 'text-danger-on-subtle',
    info: 'text-info-on-subtle',
    brand: 'text-content-on-brand-subtle',
};

/**
 * The glyph a `label` carries for each tone. A `pill` carries a dot instead — see `Badge`.
 */
const TONE_ICON: Readonly<Record<BadgeTone, IconName | null>> = {
    neutral: null,
    success: 'success',
    warning: 'warning',
    danger: 'error',
    info: 'info',
    brand: 'dot',
};

/**
 * Nutrition levels get a *pattern word* alongside the colour, taken straight from the token's
 * `pattern` field, because the five-stop scale is exactly the case where colour alone fails. The
 * surfaces, foregrounds and marker come from `internal/nutrition.ts`, which is the single source
 * every nutrition-aware component reads — a badge and a meter must never disagree about what
 * "moderate" looks like in greyscale.
 */

export interface BadgeProps {
    readonly label: string;
    readonly tone?: BadgeTone | undefined;
    /** Switches to the nutrition scale, which brings its own colour and pattern. */
    readonly nutrition?: NutritionLevel | undefined;
    /**
     * Draws this icon where the tone's default mark would sit — the dot on a `pill`, the glyph on a
     * `label`. `null` drops the mark; do that only when the tone is decoration rather than news.
     */
    readonly icon?: IconName | null | undefined;
    /**
     * `pill` (the default) is the status badge: the subtle fill, no border, a dot in the tone's ink
     * before the word. The other two are the Catalogue Forms
     * labels (`Labels` in the design), for the desk surfaces:
     *
     * - `label` — a 16px tag at the control corner, the subtle fill with no border, the tone's mark
     *   in its strong ink before the text. What sits beside a section title: `ⓘ From database`,
     *   `⚠ Estimated`.
     * - `caps` — the record's state beside a page title: `DRAFT`, `RESTRICTED`. Capitals from the
     *   stylesheet (Arabic has no case), 10px on a 16px tag, and no mark unless one is passed,
     *   because the word is the whole of it and a glyph at that size is noise.
     */
    readonly variant?: BadgeVariant | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

export function Badge({
    label,
    tone = 'neutral',
    nutrition,
    icon,
    variant = 'pill',
    className,
    testID,
}: BadgeProps) {
    const density = useDensity();
    const compact = density === 'compact';
    /*
     * The soft tag (Badges & Callouts, 1a): 20px tall, 18 in the admin, so a status sits inside a
     * 32px row without setting the row's height. The corner is the control's small step rather than
     * a full round — a status is a label on a record, not a button to press. The start inset is the
     * tighter one, because the dot already holds that edge.
     */
    const labelClass = compact ? 'text-role-caption font-medium' : 'text-xs font-medium';
    const frameClass = compact
        ? 'h-[18px] gap-1 rounded-sm pe-1.5 ps-1'
        : 'h-5 gap-1 rounded-sm pe-2 ps-1.5';

    if (nutrition !== undefined) {
        return (
            <View
                testID={testID}
                accessibilityRole="text"
                accessibilityLabel={label}
                className={cx(
                    'flex-row items-center self-start',
                    frameClass,
                    NUTRITION_SURFACE_CLASS[nutrition],
                    className,
                )}
            >
                <RNText
                    testID={testID === undefined ? undefined : `${testID}-pattern`}
                    aria-hidden
                    accessibilityElementsHidden
                    className={cx(labelClass, 'tracking-wide', NUTRITION_ON_CLASS[nutrition])}
                >
                    {nutritionMark(nutrition)}
                </RNText>
                <RNText className={cx(labelClass, NUTRITION_ON_CLASS[nutrition])}>{label}</RNText>
            </View>
        );
    }

    if (variant !== 'pill') {
        const resolvedIcon = icon === undefined ? TONE_ICON[tone] : icon;
        const caps = variant === 'caps';
        // `caps` draws no mark by default; an explicit `icon` still wins.
        const mark = caps ? (icon ?? null) : resolvedIcon;
        return (
            <View
                testID={testID}
                accessibilityRole="text"
                accessibilityLabel={label}
                /*
                 * No `self-start`, unlike the pill. These sit in a row beside a title — a page
                 * title, a section title — and `self-start` overrode the row's own centring, so a
                 * 16px tag hung from the top of a 22px heading while the reference beside it sat on
                 * the baseline. The row decides; every caller of these two variants is a row.
                 *
                 * 16px tall, on the ramp's smallest step: the type cannot go below `micro` without
                 * a half-step the scale refuses, so the tag is made smaller by its box instead.
                 */
                className={cx(
                    'h-4 flex-row items-center gap-1',
                    caps ? 'rounded-xs px-1' : 'rounded-sm pe-1.5 ps-1',
                    TONE_FILL_CLASS[tone],
                    className,
                )}
            >
                {mark === null ? null : (
                    <Icon
                        testID={testID === undefined ? undefined : `${testID}-icon`}
                        name={mark}
                        size="sm"
                        className={TONE_MARK_CLASS[tone]}
                    />
                )}
                <RNText
                    className={cx(
                        caps ? 'text-role-micro uppercase tracking-wide' : 'text-role-micro',
                        TONE_TEXT_CLASS[tone],
                    )}
                >
                    {label}
                </RNText>
            </View>
        );
    }

    /*
     * The pill's mark is a dot, not a glyph. At 11px a cross, a triangle and a circled `i` were three
     * smudges of the same size, so the shapes were never what a reader told the tones apart by —
     * the word is: `Overdue`, `Low stock`, `In prep`. The dot is the colour cue that survives at that
     * size, and neutral goes without, so a greyscale reading still separates "has a state" from
     * "is a plain tag". A caller who needs a shape passes `icon` and it is drawn in the dot's place.
     */
    const dot = icon === undefined && tone !== 'neutral';

    return (
        <View
            testID={testID}
            accessibilityRole="text"
            accessibilityLabel={label}
            className={cx(
                'flex-row items-center self-start',
                frameClass,
                TONE_FILL_CLASS[tone],
                className,
            )}
        >
            {dot ? (
                <View
                    testID={testID === undefined ? undefined : `${testID}-mark`}
                    aria-hidden
                    accessibilityElementsHidden
                    className={cx('h-1.5 w-1.5 rounded-full', TONE_DOT_CLASS[tone])}
                />
            ) : null}
            {icon === undefined || icon === null ? null : (
                <Icon
                    testID={testID === undefined ? undefined : `${testID}-icon`}
                    name={icon}
                    size="sm"
                    className={TONE_DOT_INK_CLASS[tone]}
                />
            )}
            <RNText className={cx(labelClass, TONE_TEXT_CLASS[tone])}>{label}</RNText>
        </View>
    );
}

export { NUTRITION_LEVELS };
export type { NutritionLevel };
