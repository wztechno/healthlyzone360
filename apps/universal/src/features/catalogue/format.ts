import {
    ENERGY_PER_GRAM,
    MACRO_NUTRIENT_IDS,
    amountValue,
    normaliseToPer100g,
} from '@healthy360/nutrition';
import type { MacroNutrientId, NutritionFacts } from '@healthy360/nutrition';

/**
 * Presentation arithmetic for the catalogue screens.
 *
 * Everything here is a conversion a screen would otherwise do inline and get subtly wrong twice:
 * the energy a macronutrient contributes, the per-100 g re-basing, and the two unit conversions the
 * public calculators need. They are pure functions with no React and no i18n so they can be tested
 * as arithmetic rather than through a render.
 */

export const MACRO_IDS: readonly MacroNutrientId[] = MACRO_NUTRIENT_IDS;

export interface MacroShare {
    readonly nutrientId: MacroNutrientId;
    readonly grams: number;
    readonly kilocalories: number;
    /** Share of the set's declared energy, 0–100. `0` when the set declares no energy. */
    readonly percentageOfEnergy: number;
}

/**
 * What each macronutrient contributes to a set of facts.
 *
 * The percentage is taken against the **declared** energy figure rather than against the sum of the
 * three macro contributions. Those two are not identical — fibre, sugar alcohols and rounding all
 * move them apart — and dividing by the reconstructed total would quietly present a figure the
 * label does not carry.
 */
export function macroBreakdown(facts: NutritionFacts): readonly MacroShare[] {
    const energy = amountValue(facts, 'energy');

    return MACRO_IDS.map((nutrientId) => {
        const grams = amountValue(facts, nutrientId);
        const kilocalories = grams * ENERGY_PER_GRAM[nutrientId];
        return {
            nutrientId,
            grams: Math.round(grams * 10) / 10,
            kilocalories: Math.round(kilocalories),
            percentageOfEnergy: energy > 0 ? Math.round((kilocalories / energy) * 100) : 0,
        };
    });
}

/**
 * The same facts re-expressed per 100 grams, or `null` when that cannot be done honestly.
 *
 * `normaliseToPer100g` throws without a positive total mass, and a drink measured only in
 * millilitres genuinely has none. Catching that here rather than at each call site is what stops a
 * facts panel from crashing on a legitimate gap in the data — the panel says the comparison is
 * unavailable instead.
 */
export function per100gFacts(facts: NutritionFacts): NutritionFacts | null {
    if (facts.totalGrams === null || facts.totalGrams <= 0) return null;
    try {
        return normaliseToPer100g(facts, { method: 'catalogue.per_100g_view' });
    } catch {
        return null;
    }
}

/** Nutrients a facts panel lists, in label order: energy, the macros, then everything else. */
export function orderedNutrientIds(facts: NutritionFacts): readonly string[] {
    const leading = ['energy', ...MACRO_IDS, 'fibre'];
    const present = new Set(facts.amounts.map((amount) => amount.nutrientId));
    const head = leading.filter((id) => present.has(id));
    const tail = facts.amounts
        .map((amount) => amount.nutrientId)
        .filter((id) => !leading.includes(id));
    return [...head, ...tail];
}

/* ── unit conversion for the public calculators ──────────────────────────────────────────────── */

export const CENTIMETRES_PER_INCH = 2.54;
export const INCHES_PER_FOOT = 12;
export const KILOGRAMS_PER_POUND = 0.45359237;

export function centimetresFromFeetInches(feet: number, inches: number): number {
    return (feet * INCHES_PER_FOOT + inches) * CENTIMETRES_PER_INCH;
}

export interface FeetInches {
    readonly feet: number;
    readonly inches: number;
}

/**
 * Centimetres back to feet and whole inches.
 *
 * Rounding to a whole inch can carry into the next foot (`11.6 in` becomes `12 in`, which is one
 * foot and zero inches). Doing that here rather than at the field means the imperial control never
 * displays "5 ft 12 in", which is what a naive `Math.round` per component produces
 * (doc 17, ONB-03: a unit switch preserves the value rather than clearing it).
 */
export function feetInchesFromCentimetres(centimetres: number): FeetInches {
    const totalInches = Math.round(centimetres / CENTIMETRES_PER_INCH);
    return {
        feet: Math.floor(totalInches / INCHES_PER_FOOT),
        inches: totalInches % INCHES_PER_FOOT,
    };
}

export function kilogramsFromPounds(pounds: number): number {
    return pounds * KILOGRAMS_PER_POUND;
}

export function poundsFromKilograms(kilograms: number): number {
    return kilograms / KILOGRAMS_PER_POUND;
}

/** Rounds to one decimal place — the precision a household scale actually reports. */
export function roundToTenth(value: number): number {
    return Math.round(value * 10) / 10;
}
