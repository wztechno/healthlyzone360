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
 * nothing else changed, and the chunk absorbed them.
 */

export { AllergenClassesScreen } from './allergen-classes-screen.tsx';
export { IngredientEditScreen } from './ingredient-edit-screen.tsx';
export { IngredientsScreen } from './ingredients-screen.tsx';
export { KitchenHomeScreen } from './kitchen-home-screen.tsx';
export { MealEditScreen } from './meal-edit-screen.tsx';
export { MealsScreen } from './meals-screen.tsx';
export { PlanEditScreen } from './plan-edit-screen.tsx';
export { PlansScreen } from './plans-screen.tsx';
export { PriceListEditScreen } from './price-list-edit-screen.tsx';
export { PriceListsScreen } from './price-lists-screen.tsx';
export { ProductEditScreen } from './product-edit-screen.tsx';
export { ProductsScreen } from './products-screen.tsx';
export { RecipeEditScreen } from './recipe-edit-screen.tsx';
export { RecipesScreen } from './recipes-screen.tsx';
