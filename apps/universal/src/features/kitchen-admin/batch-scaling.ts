import type { RecipeVersionAdmin } from '@healthy360/api-client/contracts';
import type { MeasureUnit } from '@healthy360/nutrition';

import { normaliseQuantity, unitDimension } from './format.ts';

/**
 * Scaling a recipe version to a batch — the whole arithmetic of the batch planner, as pure
 * functions.
 *
 * Client-side and nothing else: there is no scaling endpoint, and there does not need to be. A
 * version already states what it makes (`yieldQuantity` in `yieldUnit`, and `yieldPieces` when it
 * counts), so "how much of each line for 10 kg?" is one division and one multiplication per row.
 * Keeping it here rather than in the screen is what lets the interesting cases — a target of zero,
 * a recipe with no piece count, a box that cannot be bought in fifths — be asserted without
 * rendering anything.
 *
 * **The arithmetic never converts a unit.** A line written in grams scales in grams; the planner
 * never turns 2500 g into 2.5 kg on the way to a figure. The one re-expression is on the way *out*:
 * {@link displayQuantity} reads a fraction of a kilogram as grams (and of a litre as millilitres),
 * because a cook weighs out 526 g and not 0.526 kg — and it borrows `format.ts`'s conversion table
 * rather than keeping a second one here.
 */

/** Which figure the cook is stating: a quantity in the yield unit, or a number of pieces. */
export type BatchMode = 'yield' | 'pieces';

/**
 * How many times over the recipe is being made, or `null` when that cannot be answered.
 *
 * `null` covers every unusable case as one: nothing typed, a zero or negative target, a version
 * with no yield recorded, and pieces mode on a recipe that does not count in pieces. They are one
 * answer because the screen gives them one treatment — it asks for a target instead of scaling —
 * and a caller that had to distinguish "no yield" from "no target" would be re-deriving what the
 * controls already say.
 *
 * The factor is deliberately not rounded. `10 ÷ 3` is 3.333…, and rounding it to a "sensible"
 * number of batches here would quietly restate the quantity the cook asked for.
 */
export function batchFactor(
    version: Pick<RecipeVersionAdmin, 'yieldQuantity' | 'yieldPieces'>,
    mode: BatchMode,
    target: number | null,
): number | null {
    const base = mode === 'pieces' ? version.yieldPieces : version.yieldQuantity;
    if (base === null || !Number.isFinite(base) || base <= 0) return null;
    if (target === null || !Number.isFinite(target) || target <= 0) return null;
    return target / base;
}

/**
 * An ingredient quantity at this factor. Exact, never rounded.
 *
 * A fraction of a countable ingredient is a real instruction: one egg at 0.4 of a batch is 0.4 of
 * an egg, and a cook beating two eggs and using part of them is how that gets weighed out. Rounding
 * it up would silently change the recipe's proportions, which are the only thing this page exists
 * to preserve.
 *
 * ponytail: no waste uplift. `wastePercent` is shown beside the figures as information and is not
 * multiplied in — the kitchens' sheets state process loss on the *output*, not on each input. If
 * the kitchen decides a batch should be over-weighed to land on its yield, the flip is one factor:
 * `factor * (1 + version.wastePercent / 100)` applied here.
 */
export function scaleLine(quantity: number, factor: number): number {
    return quantity * factor;
}

/**
 * A packaging quantity at this factor, rounded **up** on anything counted.
 *
 * Packaging is the one place a fraction is not an instruction. Half a box is not a thing anybody
 * can pick off a shelf, and a planner that asked for 2.4 boxes would have a cook take two and run
 * out. So `count` and `package` units ceil; mass and volume — a litre of brine filling bottles,
 * cling film by the metre — stay exact, because those genuinely are divisible.
 */
export function scalePackaging(quantity: number, factor: number, unit: MeasureUnit): number {
    const scaled = quantity * factor;
    const dimension = unitDimension(unit);
    if (dimension !== 'count' && dimension !== 'package') return scaled;
    // Floating point first: 3 × (2.1 ÷ 0.7) is 9.000000000000002, and a bare ceil would call that
    // ten boxes. A figure within a billionth of a whole number is that whole number.
    return Math.ceil(scaled - WHOLE_NUMBER_TOLERANCE);
}

/** Far below any count a kitchen states, far above the error a product of two decimals carries. */
const WHOLE_NUMBER_TOLERANCE = 1e-9;

/** The unit a fraction of the larger one is read in. Two pairs; the table in `format.ts` has no more. */
const SMALLER_UNIT: Readonly<Partial<Record<MeasureUnit, MeasureUnit>>> = { kg: 'g', l: 'ml' };

/**
 * A scaled quantity, in the unit a cook would actually read it in.
 *
 * Under one kilogram reads as grams and under one litre as millilitres — `0.526 kg` is `526 g` on
 * the scale, and a column of `0.012 Kg` is a column of numbers nobody weighs. The figure is not
 * changed, only restated, so it stays exact; anything at or above one unit, in any other unit, or
 * empty, comes back as it was.
 */
export function displayQuantity(
    quantity: number,
    unit: MeasureUnit,
): { readonly quantity: number; readonly unit: MeasureUnit } {
    const smaller = SMALLER_UNIT[unit];
    if (smaller === undefined || quantity <= 0 || quantity >= 1) return { quantity, unit };
    const restated = normaliseQuantity(quantity, unit, smaller);
    return restated === null ? { quantity, unit } : { quantity: restated, unit: smaller };
}
