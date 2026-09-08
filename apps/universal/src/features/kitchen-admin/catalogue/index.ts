/**
 * The Catalogue's shell — handoff §4.1's six parts, plus §4.2's collapsible nav.
 *
 * A list screen is these in order and nothing else:
 *
 * ```tsx
 * <CataloguePageHeader … />     // breadcrumb (with the ☰), optional title, the actions
 * <CatalogueStatCards … />      // the four figures — or `CatalogueSummaryBar` for the one line
 * <CatalogueToolbar … />        // one 28px row: search and the status segments
 * <CatalogueList … />           // the spec-driven grid, or two-line rows below `md`
 * <CataloguePager … />          // range + compact buttons
 * ```
 *
 * `CatalogueStatCards` and `CatalogueSummaryBar` are the same four figures at two densities. A page
 * draws one of them, never both.
 *
 * All of it wrapped once, high up, in `CatalogueNavProvider` — the open state has to outlive the
 * screen for the rail not to reappear on every navigation.
 */

export { CataloguePageHeader } from './catalogue-page-header.tsx';
export type { CataloguePageHeaderProps } from './catalogue-page-header.tsx';

export { CatalogueSummaryBar } from './catalogue-summary-bar.tsx';
export type { CatalogueSummaryBarProps } from './catalogue-summary-bar.tsx';

export { CATALOGUE_STAT_TONES, CatalogueStatCards } from './catalogue-stat-cards.tsx';
export type {
    CatalogueStatCard,
    CatalogueStatCardsProps,
    CatalogueStatTone,
} from './catalogue-stat-cards.tsx';

export { CATALOGUE_SEARCH_WIDTH, CatalogueToolbar } from './catalogue-toolbar.tsx';
export type { CatalogueStatusSegment, CatalogueToolbarProps } from './catalogue-toolbar.tsx';

export { CatalogueList } from './catalogue-list.tsx';
export type { CatalogueListProps } from './catalogue-list.tsx';

export { CatalogueListItem } from './catalogue-list-item.tsx';
export type { CatalogueListItemProps } from './catalogue-list-item.tsx';

export { DerivedPanel } from './derived-panel.tsx';
export type { DerivedFigure, DerivedPanelProps } from './derived-panel.tsx';

export { CatalogueViewDrawer } from './catalogue-view-drawer.tsx';
export type {
    CatalogueViewDrawerProps,
    CatalogueViewField,
} from './catalogue-view-drawer.tsx';

export { CataloguePager } from './catalogue-pager.tsx';
export type { CataloguePagerProps } from './catalogue-pager.tsx';

export {
    CATALOGUE_COLUMN_ROLES,
    CATALOGUE_PRIORITY,
    columnFloor,
    columnForRole,
} from './catalogue-column-spec.ts';
export type { CatalogueColumn, CatalogueColumnRole } from './catalogue-column-spec.ts';

export {
    CATALOGUE_NAV_TRANSITION_MS,
    CatalogueNavProvider,
    CatalogueNavToggle,
    useCatalogueNav,
    useCataloguePort,
} from './catalogue-nav.tsx';
export type {
    CatalogueNavProviderProps,
    CatalogueNavState,
    CatalogueNavToggleProps,
    CataloguePort,
} from './catalogue-nav.tsx';

/* ── the per-entity specs and their list state ───────────────────────────────────────────────── */

/*
 * A Catalogue list page is one of these pairs plus the shell above. That is the claim §4.1 makes
 * and the reason five entities share one component set: the array says which tracks, the hook says
 * what the page knows, and neither knows anything about the other's entity.
 */

export { ingredientColumns } from './ingredient-columns.tsx';
export type { IngredientColumnDeps } from './ingredient-columns.tsx';

export { recipeColumns } from './recipe-columns.tsx';
export type { RecipeColumnDeps } from './recipe-columns.tsx';

export { productColumns } from './product-columns.tsx';
export type { ProductColumnDeps } from './product-columns.tsx';

export { mealColumns } from './meal-columns.tsx';
export type { MealColumnDeps } from './meal-columns.tsx';

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
export type {
    RecipeListState,
    RecipeSortDirection,
    RecipeSortKey,
} from './use-recipe-list.ts';

export { useProductList } from './use-product-list.ts';
export type {
    ProductItemType,
    ProductListState,
    ProductSortDirection,
    ProductSortKey,
} from './use-product-list.ts';

export { useMealList } from './use-meal-list.ts';
export type { MealListState, MealSortDirection, MealSortKey } from './use-meal-list.ts';

export { PACKAGING_STATUS_FILTERS, usePackagingList } from './use-packaging-list.ts';
export type {
    PackagingListState,
    PackagingSortDirection,
    PackagingSortKey,
} from './use-packaging-list.ts';
