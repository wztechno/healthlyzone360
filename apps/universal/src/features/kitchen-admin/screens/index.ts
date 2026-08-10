/**
 * The kitchen workspace's screens, as one lazily-loaded module.
 *
 * ## Why a barrel exists here and nowhere else in this codebase
 *
 * Every route under `app/kitchen/` is code-split (`src/shell/lazy-screen.tsx`), and the obvious way
 * to write that is one dynamic import per route file. Metro then emits one async chunk per *screen*,
 * which is correct for the export budget and wrong for the person using the workspace: opening the
 * hub, then the recipe book, then a recipe is three round trips before anything appears, each one on
 * the critical path of a click. Under a loaded static server the effect is measurable — the browser
 * tests were the first place it showed.
 *
 * Splitting per **area** instead keeps the whole benefit and drops the cost. The kitchen workspace
 * is one job somebody sits down to do, so its eleven screens are one chunk: the first kitchen route
 * fetches it, and every navigation inside the workspace afterwards is free. The entry bundle is just
 * as much smaller either way — the code is out of it either way — and a consumer browsing meal plans
 * still never downloads a price-list editor.
 *
 * The rule, so the next slice does not have to rediscover it: **one chunk per route area, not one
 * per screen.** K1.6's plan list and plan editor were added to this file and to two thin routes;
 * K1.7's zone list, zone editor and branch-hours screen the same way; K1.8's review queue is one
 * more line here and one more thin route. Nothing else changed any of those times, and the chunk
 * absorbed them.
 */

export { AllergenClassesScreen } from './allergen-classes-screen.tsx';
export { AnalyticsScreen } from './analytics-screen.tsx';
export { BranchOperatingScreen } from './branch-operating-screen.tsx';
export { ConsumptionExceptionsScreen } from './consumption-exceptions-screen.tsx';
export { CostReportScreen } from './cost-report-screen.tsx';
export { DeliveryZoneEditScreen } from './delivery-zone-edit-screen.tsx';
export { DeliveryZonesScreen } from './delivery-zones-screen.tsx';
export { IngredientEditScreen } from './ingredient-edit-screen.tsx';
export { IngredientsScreen } from './ingredients-screen.tsx';
export { KitchenHomeScreen } from './kitchen-home-screen.tsx';
export { MealEditScreen } from './meal-edit-screen.tsx';
export { MealsScreen } from './meals-screen.tsx';
export { OrdersScreen } from './orders-screen.tsx';
export { PlanEditScreen } from './plan-edit-screen.tsx';
export { PlansScreen } from './plans-screen.tsx';
export { PriceListEditScreen } from './price-list-edit-screen.tsx';
export { PriceListsScreen } from './price-lists-screen.tsx';
export { ProcurementScreen } from './procurement-screen.tsx';
export { ProductEditScreen } from './product-edit-screen.tsx';
export { ProductsScreen } from './products-screen.tsx';
export { ProductionScreen } from './production-screen.tsx';
export { PurchasesLedgerScreen } from './purchases-ledger-screen.tsx';
export { QualityControlScreen } from './quality-control-screen.tsx';
export { RecipeEditScreen } from './recipe-edit-screen.tsx';
export { RecipesScreen } from './recipes-screen.tsx';
export { ReviewScreen } from './review-screen.tsx';
export { StockScreen } from './stock-screen.tsx';
