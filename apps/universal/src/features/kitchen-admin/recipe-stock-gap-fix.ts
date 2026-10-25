import { IngredientId } from '@healthy360/domain-types';

/**
 * The recipe editor's half of "Stock gaps → Fix in recipe → back".
 *
 * A stock gap the kitchen can only close by changing a recipe opens the recipe with three query
 * params beside its own: `returnTo` (the exact Stock gaps view, read through `useReturnTo`), `fix`
 * (the gap's reason) and `ingredient` (the line it is about, when it is about one). This file reads
 * the last two and says where on the recipe the fix lives, so the editor can open on that field,
 * mark it, and say what is wrong with it.
 *
 * Only four reasons are fixed on a recipe. Anything else — an unknown code, a hand-typed link —
 * reads as no fix at all, and the page opens as it always does.
 */

export const STOCK_GAP_FIX_REASONS = [
    'no_recipe_version',
    'no_yield_piece_count',
    'unquantified_recipe_line',
    'unit_conversion_unsupported',
] as const;

export type StockGapFixReason = (typeof STOCK_GAP_FIX_REASONS)[number];

export interface StockGapFix {
    readonly reason: StockGapFixReason;
    /** The line's ingredient, for the two reasons that are about a line; otherwise `null`. */
    readonly ingredientId: string | null;
}

function first(value: unknown): unknown {
    return Array.isArray(value) ? (value as readonly unknown[])[0] : value;
}

function isFixReason(value: unknown): value is StockGapFixReason {
    return (STOCK_GAP_FIX_REASONS as readonly unknown[]).includes(value);
}

/** Whether the reason is about one recipe line rather than the recipe as a whole. */
export function isLineReason(reason: StockGapFixReason): boolean {
    return reason === 'unquantified_recipe_line' || reason === 'unit_conversion_unsupported';
}

/**
 * `?fix=` and `?ingredient=` as the route hands them over, or `null` when they name no fix this
 * page can make. An ingredient that is not an id is dropped rather than trusted.
 */
export function parseStockGapFix(fix: unknown, ingredient: unknown): StockGapFix | null {
    const reason = first(fix);
    if (!isFixReason(reason)) return null;
    const id = IngredientId.safeParse(first(ingredient));
    return { reason, ingredientId: id === null ? null : String(id) };
}

/** The Pieces produced field on Production — what `no_yield_piece_count` is fixed in. */
export const STOCK_GAP_PIECES_FIELD = 'kitchen-recipe-yield-pieces';

/** The header's Publish — what `no_recipe_version` is fixed by. */
export const STOCK_GAP_PUBLISH_FIELD = 'kitchen-recipe-publish';

/**
 * The element id of the field the fix lives in, or `null` when it cannot be found on the page.
 *
 * @param lineFieldId the id of the quantity cell of the first line naming an ingredient, or `null`
 *   when no line names it — the table owns its row keys, so the caller answers this.
 */
export function stockGapFieldId(
    fix: StockGapFix,
    lineFieldId: (ingredientId: string) => string | null,
): string | null {
    switch (fix.reason) {
        case 'no_yield_piece_count':
            return STOCK_GAP_PIECES_FIELD;
        case 'no_recipe_version':
            return STOCK_GAP_PUBLISH_FIELD;
        case 'unquantified_recipe_line':
        case 'unit_conversion_unsupported':
            return fix.ingredientId === null ? null : lineFieldId(fix.ingredientId);
    }
}

/** What the flagged field says while it still needs the fix; `null` for a reason with no field. */
export function stockGapFieldMessageKey(
    reason: StockGapFixReason,
):
    | 'kitchen:ops.exceptions.fix.piecesMissing'
    | 'kitchen:ops.exceptions.fix.quantityMissing'
    | 'kitchen:ops.exceptions.fix.unitMismatch'
    | null {
    switch (reason) {
        case 'no_yield_piece_count':
            return 'kitchen:ops.exceptions.fix.piecesMissing';
        case 'unquantified_recipe_line':
            return 'kitchen:ops.exceptions.fix.quantityMissing';
        case 'unit_conversion_unsupported':
            return 'kitchen:ops.exceptions.fix.unitMismatch';
        case 'no_recipe_version':
            return null;
    }
}
