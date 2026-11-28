/**
 * The Catalogue's shell — handoff §4.1's six parts, plus §4.2's collapsible nav.
 *
 * A list screen is these in order and nothing else:
 *
 * ```tsx
 * <LensBar … />                 // the figures and the query row (design system)
 * <DataTable … />           // the spec-driven grid, or two-line rows below `md`
 * <TablePager … />          // range + compact buttons
 * ```
 */

export { DerivedPanel } from './derived-panel.tsx';
export type { DerivedFigure, DerivedPanelProps } from './derived-panel.tsx';

export { RecordViewPage } from './record-view-page.tsx';
export type {
    CatalogueViewField,
    RecordViewPageProps,
    RecordViewSection,
} from './record-view-page.tsx';

/* ── the per-entity specs and their list state ───────────────────────────────────────────────── */

/*
 * A Catalogue list page is one of these pairs plus the shell above. That is the claim §4.1 makes
 * and the reason four entities share one component set: the array says which tracks, the hook says
 * what the page knows, and neither knows anything about the other's entity.
 */

export { ingredientColumns } from './ingredient-columns.tsx';
export type { IngredientColumnDeps } from './ingredient-columns.tsx';

export { recipeColumns } from './recipe-columns.tsx';
export type { RecipeColumnDeps } from './recipe-columns.tsx';

export { productColumns } from './product-columns.tsx';
export type { ProductColumnDeps } from './product-columns.tsx';

export {
    packagingColumns,
    packagingRowTestId,
    packagingStatusKey,
    packagingStatusTone,
} from './packaging-columns.tsx';
export type { PackagingColumnDeps } from './packaging-columns.tsx';

export { useIngredientList } from './use-ingredient-list.ts';
export type {
    IngredientListState,
    IngredientSortDirection,
    IngredientSortKey,
} from './use-ingredient-list.ts';

export { useRecipeList } from './use-recipe-list.ts';
export type { RecipeListState, RecipeSortDirection, RecipeSortKey } from './use-recipe-list.ts';

export { useProductList } from './use-product-list.ts';
export type {
    ProductItemType,
    ProductListState,
    ProductSortDirection,
    ProductSortKey,
} from './use-product-list.ts';

export { PACKAGING_STATUS_FILTERS, usePackagingList } from './use-packaging-list.ts';
export type {
    PackagingListState,
    PackagingSortDirection,
    PackagingSortKey,
} from './use-packaging-list.ts';
