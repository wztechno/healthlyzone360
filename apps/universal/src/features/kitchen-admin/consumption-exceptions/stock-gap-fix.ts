import type {
    ConsumptionException,
    ConsumptionExceptionReasonCode,
} from '@healthy360/api-client/contracts';

import { withQuery, withReturnTo } from '../../../navigation/return-to.ts';

/**
 * The Stock gaps half of "Stock gaps → Fix in recipe → back": which gaps a recipe fixes, the
 * address of the recipe page that fixes one, and the address of the exact Stock gaps view to come
 * back to.
 *
 * ## The list keeps its place in the URL
 *
 * `/kitchen/consumption-exceptions` carries its status, raised-from date, page and open record as
 * query params ({@link stockGapsHref}), so the address the recipe page is handed as `returnTo` is
 * the view the reader left — same filter, same page, the same gap open — and coming back lands on
 * it. Every default is left out, so the plain list is still the plain path.
 *
 * ## The contract with the recipe editor
 *
 * {@link recipeFixHref} opens the recipe with `fix` (the gap's reason), `ingredient` (the line it
 * is about, when it is about one) and `returnTo`. The recipe editor reads exactly those three
 * (`recipe-stock-gap-fix.ts`) and, once the fix is published, returns with `fixed=1`, which makes
 * Retry the record's next step.
 */

export const STOCK_GAPS_PATH = '/kitchen/consumption-exceptions';

/** The reasons a recipe change fixes. Every other gap is fixed on a shelf, a product or an order. */
export const RECIPE_FIX_REASONS = [
    'no_recipe_version',
    'no_yield_piece_count',
    'unquantified_recipe_line',
    'unit_conversion_unsupported',
] as const satisfies readonly ConsumptionExceptionReasonCode[];

export type StockGapStatus = 'unresolved' | 'resolved' | 'all';

/** Every unresolved gap, whenever it opened — the count the sidebar and the home tile link here with. */
export const DEFAULT_STOCK_GAP_STATUS: StockGapStatus = 'unresolved';

type FixableFields = Pick<
    ConsumptionException,
    'reasonCode' | 'itemType' | 'catalogueItemId' | 'ingredientId'
>;

/**
 * Whether the gap is fixed in a recipe this page can open.
 *
 * The reason has to be one a recipe fixes, and the sold item a meal (or gone from the catalogue,
 * when only its id is left) — sauces and products are fixed elsewhere. `unit_conversion_unsupported`
 * is also raised at the cost stage, where no recipe line is at fault, so it needs the ingredient the
 * detail named.
 */
export function canFixInRecipe(row: FixableFields): boolean {
    if (!(RECIPE_FIX_REASONS as readonly string[]).includes(row.reasonCode)) return false;
    if (row.itemType !== 'meal' && row.itemType !== null) return false;
    if (row.catalogueItemId === null) return false;
    if (row.reasonCode === 'unit_conversion_unsupported' && row.ingredientId === null) return false;
    return true;
}

export interface StockGapsView {
    readonly status: StockGapStatus;
    /** `YYYY-MM-DD`, or `''` for no lower bound. */
    readonly from: string;
    readonly page: number;
    /** The open record's id, or `null` on the list. */
    readonly gap: string | null;
    /** `true` when the open gap's recipe fix has been published and Retry is what is left. */
    readonly fixed: boolean;
}

/** The Stock gaps view as an href — defaults left out, so the plain list is the plain path. */
export function stockGapsHref(view: Partial<StockGapsView>): string {
    return withQuery(STOCK_GAPS_PATH, {
        status:
            view.status === undefined || view.status === DEFAULT_STOCK_GAP_STATUS
                ? undefined
                : view.status,
        from: view.from,
        page: view.page === undefined || view.page <= 1 ? undefined : view.page,
        gap: view.gap ?? undefined,
        fixed: view.fixed === true ? '1' : undefined,
    });
}

/** What `router.setParams` writes for a view — `undefined` clears a param, as a default does. */
export function stockGapsParams(view: StockGapsView): Readonly<Record<string, string | undefined>> {
    return {
        status: view.status === DEFAULT_STOCK_GAP_STATUS ? undefined : view.status,
        from: view.from === '' ? undefined : view.from,
        page: view.page <= 1 ? undefined : String(view.page),
        gap: view.gap ?? undefined,
        fixed: view.fixed ? '1' : undefined,
    };
}

function first(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

export interface StockGapsRouteParams {
    readonly status?: string | string[] | undefined;
    readonly from?: string | string[] | undefined;
    readonly page?: string | string[] | undefined;
    readonly gap?: string | string[] | undefined;
    readonly fixed?: string | string[] | undefined;
}

/** The view a URL asks for. Anything unreadable falls back to its default rather than failing. */
export function readStockGapsView(params: StockGapsRouteParams): StockGapsView {
    const status = first(params.status);
    const from = first(params.from) ?? '';
    const page = Number.parseInt(first(params.page) ?? '', 10);
    const gap = first(params.gap) ?? '';
    return {
        status:
            status === 'resolved' || status === 'unresolved' || status === 'all'
                ? status
                : DEFAULT_STOCK_GAP_STATUS,
        from: /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : '',
        page: Number.isInteger(page) && page > 1 ? page : 1,
        gap: gap === '' ? null : gap,
        fixed: first(params.fixed) === '1',
    };
}

type RecipeFixFields = Pick<
    ConsumptionException,
    'reasonCode' | 'recipeId' | 'catalogueItemId' | 'ingredientId'
>;

/**
 * The recipe page that fixes a gap, carrying the fix and the way back.
 *
 * The recipe's own page when the sold item names one; otherwise the meal's address in the recipe
 * book, which opens the recipe it has or starts the one it lacks.
 */
export function recipeFixHref(row: RecipeFixFields, returnHref: string): string {
    const page =
        row.recipeId !== null
            ? `/kitchen/recipes/${encodeURIComponent(row.recipeId)}`
            : withQuery(`/kitchen/recipes/item/${encodeURIComponent(row.catalogueItemId ?? '')}`, {
                  kind: 'meal',
              });
    return withReturnTo(
        withQuery(page, { fix: row.reasonCode, ingredient: row.ingredientId ?? undefined }),
        returnHref,
    );
}
