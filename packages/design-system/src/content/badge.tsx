import { NUTRITION_LEVELS } from '@healthy360/design-tokens';
import type { NutritionLevel } from '@healthy360/design-tokens';
import { Text as RNText, View } from 'react-native';

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
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

export function Badge({ label, tone = 'neutral', nutrition, icon, className, testID }: BadgeProps) {
    if (nutrition !== undefined) {
        return (
            <View
                testID={testID}
                accessibilityRole="text"
                accessibilityLabel={label}
                className={cx(
                    'flex-row items-center gap-1 self-start rounded-full px-2 py-0.5',
                    NUTRITION_SURFACE_CLASS[nutrition],
                    className,
                )}
            >
                <RNText
                    testID={testID === undefined ? undefined : `${testID}-pattern`}
                    aria-hidden
                    accessibilityElementsHidden
                    className={cx('text-xs tracking-wide', NUTRITION_ON_CLASS[nutrition])}
                >
                    {nutritionMark(nutrition)}
                </RNText>
                <RNText className={cx('text-xs font-medium', NUTRITION_ON_CLASS[nutrition])}>
                    {label}
                </RNText>
            </View>
        );
    }

    const resolvedIcon = icon === undefined ? TONE_ICON[tone] : icon;

    return (
        <View
            testID={testID}
            accessibilityRole="text"
            accessibilityLabel={label}
            className={cx(
                'flex-row items-center gap-1 self-start rounded-full border px-2 py-0.5',
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
            <RNText className={cx('text-xs font-medium', TONE_TEXT_CLASS[tone])}>{label}</RNText>
        </View>
    );
}

export { NUTRITION_LEVELS };
export type { NutritionLevel };
