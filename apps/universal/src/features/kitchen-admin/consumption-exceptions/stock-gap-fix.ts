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
 * `/kitchen/consumption-exceptions` carries its status, raised-from and -until dates, page and open record as
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
    /** `YYYY-MM-DD`, or `''` for no upper bound. Inclusive, like `from`. */
    readonly to: string;
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
        to: view.to,
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
        to: view.to === '' ? undefined : view.to,
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
    readonly to?: string | string[] | undefined;
    readonly page?: string | string[] | undefined;
    readonly gap?: string | string[] | undefined;
    readonly fixed?: string | string[] | undefined;
}

/** The view a URL asks for. Anything unreadable falls back to its default rather than failing. */
export function readStockGapsView(params: StockGapsRouteParams): StockGapsView {
    const status = first(params.status);
    const from = first(params.from) ?? '';
    const to = first(params.to) ?? '';
    const page = Number.parseInt(first(params.page) ?? '', 10);
    const gap = first(params.gap) ?? '';
    return {
        status:
            status === 'resolved' || status === 'unresolved' || status === 'all'
                ? status
                : DEFAULT_STOCK_GAP_STATUS,
        from: /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : '',
        to: /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : '',
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

/**
 * Where each gap is fixed, so every gap that *can* be fixed leads somewhere.
 *
 * | Reason                                       | Fixed on                                     |
 * | -------------------------------------------- | -------------------------------------------- |
 * | the four recipe reasons                      | the recipe ({@link recipeFixHref})           |
 * | `insufficient_stock`, `no_stock_item`        | the shelf's stock movement (count or adjust) |
 * | `no_ingredient_cost`                         | the ingredient's unit price                  |
 * | `no_stock_unit`, a cost-stage unit mismatch  | the ingredient's units                       |
 * | `no_ingredient_link`, `no_net_content`       | the product                                  |
 * | `reserved_for_production`                    | the production plan                          |
 * | `no_branch`, `no_catalogue_item`             | nowhere: the order or the item is broken     |
 *
 * Every page but the production plan is handed this exact view as `returnTo`, so its Cancel, Save
 * and trail come back to the gap — the stock movement with `fixed=1`, which makes Retry next.
 */
export type StockGapFixKind = 'recipe' | 'stock' | 'ingredient' | 'product' | 'production';

export interface StockGapFixAction {
    readonly kind: StockGapFixKind;
    /** `kitchen:ops.exceptions.fixAction.*`, or `fixInRecipe`. */
    readonly labelKey: string;
    readonly href: string;
}

type GapFixFields = Pick<
    ConsumptionException,
    'reasonCode' | 'itemType' | 'catalogueItemId' | 'ingredientId' | 'recipeId'
>;

/** The page that fixes a gap, or `null` when none does or the reader may not open it. */
export function stockGapFixAction(
    row: GapFixFields,
    returnHref: string,
    may: (kind: StockGapFixKind) => boolean,
): StockGapFixAction | null {
    const action = gapFix(row, returnHref);
    return action !== null && may(action.kind) ? action : null;
}

function gapFix(row: GapFixFields, returnHref: string): StockGapFixAction | null {
    if (canFixInRecipe(row)) {
        return {
            kind: 'recipe',
            labelKey: 'kitchen:ops.exceptions.fixInRecipe',
            href: recipeFixHref(row, returnHref),
        };
    }
    switch (row.reasonCode) {
        case 'insufficient_stock':
        case 'no_stock_item':
            if (row.ingredientId === null && row.catalogueItemId === null) return null;
            return {
                kind: 'stock',
                labelKey: 'kitchen:ops.exceptions.fixAction.stock',
                href: withReturnTo(
                    withQuery('/kitchen/stock', {
                        ingredient: row.ingredientId ?? undefined,
                        item:
                            row.ingredientId === null
                                ? (row.catalogueItemId ?? undefined)
                                : undefined,
                    }),
                    returnHref,
                ),
            };
        case 'no_ingredient_cost':
            return ingredientFix(
                row.ingredientId,
                'price',
                'kitchen:ops.exceptions.fixAction.price',
                returnHref,
            );
        case 'no_stock_unit':
        case 'unit_conversion_unsupported':
            return ingredientFix(
                row.ingredientId,
                'unit',
                'kitchen:ops.exceptions.fixAction.unit',
                returnHref,
            );
        case 'no_ingredient_link':
        case 'no_net_content':
            if (row.itemType !== 'product' || row.catalogueItemId === null) return null;
            return {
                kind: 'product',
                labelKey: 'kitchen:ops.exceptions.fixAction.product',
                href: withReturnTo(
                    `/kitchen/products/${encodeURIComponent(row.catalogueItemId)}`,
                    returnHref,
                ),
            };
        case 'reserved_for_production':
            return {
                kind: 'production',
                labelKey: 'kitchen:ops.exceptions.fixAction.production',
                href: '/kitchen/production',
            };
        default:
            return null;
    }
}

function ingredientFix(
    ingredientId: string | null,
    need: 'price' | 'unit',
    labelKey: string,
    returnHref: string,
): StockGapFixAction | null {
    if (ingredientId === null) return null;
    return {
        kind: 'ingredient',
        labelKey,
        href: withReturnTo(
            withQuery(`/kitchen/ingredients/${encodeURIComponent(ingredientId)}`, { needs: need }),
            returnHref,
        ),
    };
}
