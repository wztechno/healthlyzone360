import { PACKAGING_CATEGORY_CODE } from '@healthy360/api-client/contracts';
import type {
    IngredientAdmin,
    RecipeCostHalf,
    RollupWarning,
} from '@healthy360/api-client/contracts';

import { withQuery, withReturnTo } from '../../navigation/return-to.ts';

/**
 * The recipe editor's half of "a raw material has a problem → fix it on the ingredient → back".
 *
 * A recipe can only be costed, labelled and published once every ingredient it names can answer
 * for itself: an allergen determination, confirmed nutrition, a unit the roll-up can convert, a
 * price. None of those is fixed on the recipe — each lives on the ingredient's own form — so the
 * line table names what is missing on the row and opens the ingredient with `?needs=` (what to fix)
 * and `?returnTo=` (the recipe, on the tab it was left on). The ingredient form reads `needs` to
 * point at each section and field, and its Save hands the reader straight back.
 *
 * Unknown codes in a hand-typed link are dropped, so the form opens as it always does.
 */

export const INGREDIENT_NEEDS = ['allergens', 'nutrition', 'unit', 'price'] as const;

export type IngredientNeed = (typeof INGREDIENT_NEEDS)[number];

/** `?needs=` as the route hands it over: a comma list, deduplicated, in the form's order. */
export function parseIngredientNeeds(raw: unknown): readonly IngredientNeed[] {
    const value = Array.isArray(raw) ? (raw as readonly unknown[])[0] : raw;
    if (typeof value !== 'string') return [];
    const asked = new Set(value.split(',').map((part) => part.trim()));
    return INGREDIENT_NEEDS.filter((need) => asked.has(need));
}

/**
 * The ingredient's editor, opened to fix `needs` and come back to `returnTo`. Packaging opens on
 * its own route — the same form, filed under the packaging family.
 */
export function ingredientFixHref(
    ingredientId: string,
    needs: readonly IngredientNeed[],
    returnTo: string,
    family: 'ingredients' | 'packaging',
): string {
    const base = `/kitchen/${family}/${ingredientId}`;
    return withReturnTo(
        withQuery(base, { needs: needs.length === 0 ? null : needs.join(',') }),
        returnTo,
    );
}

/**
 * What each ingredient a recipe names still owes it, by ingredient id.
 *
 * Read from what the editor already holds — the roll-up's warnings (which name their ingredients),
 * the server's costing (which names its uncosted lines by number) and the resolved ingredient rows —
 * so the table, the publish dialog and the ingredient form agree about one list.
 */
export function ingredientNeedsById(input: {
    readonly warnings: readonly RollupWarning[];
    readonly costs: readonly (RecipeCostHalf | null | undefined)[];
    readonly ingredients: readonly IngredientAdmin[];
    /** The ingredient ids the recipe's lines and packaging name — only these are asked about. */
    readonly named: ReadonlySet<string>;
}): ReadonlyMap<string, readonly IngredientNeed[]> {
    const found = new Map<string, Set<IngredientNeed>>();
    const add = (id: string, need: IngredientNeed) => {
        if (!input.named.has(id)) return;
        const set = found.get(id) ?? new Set<IngredientNeed>();
        set.add(need);
        found.set(id, set);
    };

    for (const warning of input.warnings) {
        const need: IngredientNeed | null =
            warning.code === 'rollup.missing_facts'
                ? 'allergens'
                : warning.code === 'rollup.missing_nutrition'
                  ? 'nutrition'
                  : warning.code === 'rollup.unconvertible_unit'
                    ? 'unit'
                    : null;
        if (need === null) continue;
        for (const id of warning.ingredientIds) add(String(id), need);
    }

    for (const half of input.costs) {
        if (half == null) continue;
        for (const lineNumber of half.uncostedLineNumbers) {
            const line = half.lines.find((entry) => entry.lineNumber === lineNumber);
            if (line !== undefined) add(String(line.ingredientId), 'price');
        }
    }

    for (const entry of input.ingredients) {
        // A box has no allergens and no nutrition to owe: only food is asked about either.
        if (entry.categoryCode.startsWith(PACKAGING_CATEGORY_CODE)) continue;
        const id = String(entry.id);
        if (
            entry.meta.status === 'review_required' ||
            (entry.allergens.length === 0 && entry.allergensAssessedClear !== true)
        ) {
            add(id, 'allergens');
        }
        if (entry.pendingNutrition != null) add(id, 'nutrition');
    }

    return new Map(
        [...found].map(([id, needs]) => [id, INGREDIENT_NEEDS.filter((need) => needs.has(need))]),
    );
}
