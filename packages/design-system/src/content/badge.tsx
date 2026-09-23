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

const TONE_CLASS: Readonly<Record<BadgeTone, string>> = {
    neutral: 'bg-surface-sunken border-stroke-subtle',
    success: 'bg-success-subtle border-success-border',
    warning: 'bg-warning-subtle border-warning-border',
    danger: 'bg-danger-subtle border-danger-border',
    info: 'bg-info-subtle border-info-border',
    brand: 'bg-surface-brand-subtle border-transparent',
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
 * The icon that carries each tone's meaning.
 *
 * Colour is never the only signal (WCAG 1.4.1). A "suspended" badge is not merely amber, it also
 * carries a warning mark, so it survives greyscale printing, a monochrome display and every form of
 * colour blindness.
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
    /** Overrides the tone's default icon. Pass `null` only when the label alone is unambiguous. */
    readonly icon?: IconName | null | undefined;
    /**
     * `pill` (the default) is the badge described above. The other two are the Catalogue Forms
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
    // A badge stays a pill — it is the one exception §1.3 grants — but in the admin it sets its
    // label on the ramp's smallest step, so a status chip sits inside a 32px row without setting
    // the row's height. The mark keeps its size — it is the part that survives greyscale.
    const labelClass = density === 'compact' ? 'text-role-caption' : 'text-xs font-medium';
    const insetClass = density === 'compact' ? 'gap-control-xs px-control-xs' : 'gap-1 px-2 py-0.5';

    if (nutrition !== undefined) {
        return (
            <View
                testID={testID}
                accessibilityRole="text"
                accessibilityLabel={label}
                className={cx(
                    'flex-row items-center self-start rounded-full',
                    insetClass,
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

    const resolvedIcon = icon === undefined ? TONE_ICON[tone] : icon;

    if (variant !== 'pill') {
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

    return (
        <View
            testID={testID}
            accessibilityRole="text"
            accessibilityLabel={label}
            className={cx(
                'flex-row items-center self-start rounded-full border',
                insetClass,
                TONE_CLASS[tone],
                className,
            )}
        >
            {resolvedIcon === null ? null : (
                <Icon
                    testID={testID === undefined ? undefined : `${testID}-icon`}
                    name={resolvedIcon}
                    size="sm"
                    className={TONE_TEXT_CLASS[tone]}
                />
            )}
            <RNText className={cx(labelClass, TONE_TEXT_CLASS[tone])}>{label}</RNText>
        </View>
    );
}

export { NUTRITION_LEVELS };
export type { NutritionLevel };
