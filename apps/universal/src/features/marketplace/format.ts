import { minorUnitExponent } from '@healthy360/domain-types';
import type { Money } from '@healthy360/domain-types';
import type { Formatter } from '@healthy360/i18n';
import { amountValue } from '@healthy360/nutrition';
import type { NutritionFacts } from '@healthy360/nutrition';

/**
 * Presentation helpers shared by the marketplace surfaces.
 *
 * They live together because each one is a place where a plausible-looking mistake is expensive:
 * money is integer minor units and a currency with three of them (KWD, BHD, OMR) formats wrongly if
 * you assume two; nutrient amounts are unit-tagged and reading one straight off an array index gets
 * the wrong nutrient the moment a fixture reorders.
 */

/** Money, formatted for display. Converts integer minor units to the currency's major unit first. */
export function formatMoney(formatter: Formatter, value: Money): string {
    const exponent = minorUnitExponent(value.currency);
    return formatter.formatCurrency(value.amount / 10 ** exponent, value.currency);
}

/** A nutrient's value, rounded for display. `0` when the facts carry no such nutrient. */
export function nutrientValue(facts: NutritionFacts, nutrientId: string): number {
    return Math.round(amountValue(facts, nutrientId));
}

/** ISO weekday (1 = Monday) to the translation key for its name. */
export const WEEKDAY_KEYS: readonly string[] = [
    'marketplace:weekday.monday',
    'marketplace:weekday.tuesday',
    'marketplace:weekday.wednesday',
    'marketplace:weekday.thursday',
    'marketplace:weekday.friday',
    'marketplace:weekday.saturday',
    'marketplace:weekday.sunday',
];

export function weekdayKey(isoWeekday: number): string {
    return WEEKDAY_KEYS[isoWeekday - 1] ?? 'marketplace:weekday.monday';
}

/** `marketplace:allergens.<code>`, so a code never reaches the screen untranslated by accident. */
export function allergenKey(code: string): string {
    return `marketplace:allergens.${code}`;
}
