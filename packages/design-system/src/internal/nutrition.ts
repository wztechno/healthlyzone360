import { nutritionLight } from '@healthy360/design-tokens';
import type { NutritionLevel, NutritionPattern } from '@healthy360/design-tokens';

/**
 * Non-colour facts about the five-stop nutrition scale.
 *
 * `ordinal`, `pattern` and `patternId` are identical in both themes — they are the part of the
 * scale that exists *precisely because* colour is unavailable (WCAG 1.4.1), so a theme cannot be
 * allowed to change them. The light table is the canonical source; reading them from one place is
 * what stops a bar and a badge from disagreeing about what "moderate" looks like in greyscale.
 */
export function nutritionOrdinal(level: NutritionLevel): number {
    return nutritionLight[level].ordinal;
}

export function nutritionPattern(level: NutritionLevel): NutritionPattern {
    return nutritionLight[level].pattern;
}

/** The marker character repeated once per ordinal — an ordinal signal that needs no colour at all. */
export const NUTRITION_MARK = '▮';

export function nutritionMark(level: NutritionLevel): string {
    return NUTRITION_MARK.repeat(nutritionOrdinal(level));
}

/** Background utility per stop. */
export const NUTRITION_SURFACE_CLASS: Readonly<Record<NutritionLevel, string>> = {
    optimal: 'bg-nutrition-optimal',
    good: 'bg-nutrition-good',
    moderate: 'bg-nutrition-moderate',
    high: 'bg-nutrition-high',
    excessive: 'bg-nutrition-excessive',
};

/** Foreground utility that is legible on the matching background. */
export const NUTRITION_ON_CLASS: Readonly<Record<NutritionLevel, string>> = {
    optimal: 'text-nutrition-optimal-on',
    good: 'text-nutrition-good-on',
    moderate: 'text-nutrition-moderate-on',
    high: 'text-nutrition-high-on',
    excessive: 'text-nutrition-excessive-on',
};

/** The stop's own colour used as *text*, for labels that sit on a page surface. */
export const NUTRITION_TEXT_CLASS: Readonly<Record<NutritionLevel, string>> = {
    optimal: 'text-nutrition-optimal',
    good: 'text-nutrition-good',
    moderate: 'text-nutrition-moderate',
    high: 'text-nutrition-high',
    excessive: 'text-nutrition-excessive',
};
