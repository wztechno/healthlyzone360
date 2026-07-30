import type {
    AllergenCode,
    DietClassification,
    GroceryListId,
    IngredientId,
    IsoDateTime,
    KitchenId,
    MealType,
    Money,
    RecipeId,
} from '@healthy360/domain-types';
import type {
    IngredientQuantity,
    MeasureUnit,
    NutritionFacts,
    RecipeNutrition,
    Serving,
} from '@healthy360/nutrition';

import type { CursorPage, CursorPageRequest, NumericRangeFilter } from './pagination.ts';

/**
 * Foods, recipes, the grocery list and the pantry (Prompt 2, "Recipe and meal detail").
 *
 * **Proposed, not implemented.**
 *
 * The prompt insists five things stay separate concepts, and this module keeps them separate:
 * an **ingredient** is reference data with per-100 g facts; a **food** is a searchable entry a
 * person logs; a **recipe** is our own composition of ingredients; a **kitchen recipe version** is
 * a kitchen's edit of one; a **marketplace meal** (in `./marketplace.ts`) is a sellable product.
 * Collapsing any pair of them makes the nutrition provenance unexplainable.
 */

export interface Food {
    /** Stable food identifier. Not a UUID: foods are reference data shared across tenants. */
    readonly id: string;
    readonly name: string;
    readonly brand: string | null;
    /** Per-100 g reference facts. */
    readonly per100g: NutritionFacts;
    readonly servings: readonly Serving[];
    readonly allergens: readonly AllergenCode[];
    readonly dietClassifications: readonly DietClassification[];
    /** Provenance label shown next to the figures, e.g. `Synthetic prototype data`. */
    readonly sourceLabel: string;
}

export interface RecipeStep {
    readonly index: number;
    readonly instruction: string;
    readonly minutes: number | null;
}

export interface Recipe {
    readonly id: RecipeId;
    /** Bumped on every edit; nutrition figures computed against an older version are stale. */
    readonly version: string;
    readonly name: string;
    readonly slug: string;
    readonly description: string;
    readonly mealTypes: readonly MealType[];
    readonly cuisines: readonly string[];
    readonly dietClassifications: readonly DietClassification[];
    readonly allergens: readonly AllergenCode[];
    readonly servings: number;
    readonly serving: Serving;
    readonly ingredients: readonly IngredientQuantity[];
    readonly steps: readonly RecipeStep[];
    readonly preparationMinutes: number;
    readonly cookingMinutes: number;
    /** Steps and technique, 1 (assembly) to 5 (involved). */
    readonly complexity: number;
    readonly nutrition: RecipeNutrition;
    readonly estimatedCost: Money | null;
    readonly imagePlaceholderId: string;
    /** Set when this is a kitchen's own version of the recipe rather than the platform's. */
    readonly kitchenId: KitchenId | null;
    readonly updatedAt: IsoDateTime;
}

export interface GroceryListItem {
    readonly ingredientId: IngredientId;
    readonly name: string;
    /** Aggregated across every entry in the week that needs it. */
    readonly quantity: number;
    readonly unit: MeasureUnit;
    readonly grams: number | null;
    readonly aisle: string | null;
    readonly estimatedCost: Money | null;
    /** True when the pantry already covers the whole quantity. */
    readonly inPantry: boolean;
    /** Entries that need this item, so the UI can explain why it is on the list. */
    readonly neededForRecipeIds: readonly RecipeId[];
}

export interface GroceryList {
    readonly id: GroceryListId;
    /** Monday of the week the list covers, `YYYY-MM-DD`. */
    readonly weekStart: string;
    readonly items: readonly GroceryListItem[];
    readonly estimatedTotal: Money | null;
    readonly generatedAt: IsoDateTime;
}

export interface PantryItem {
    readonly ingredientId: IngredientId;
    readonly name: string;
    readonly quantity: number;
    readonly unit: MeasureUnit;
    readonly grams: number | null;
    /** `YYYY-MM-DD`, when the person recorded one. */
    readonly bestBefore: string | null;
    readonly updatedAt: IsoDateTime;
}

export interface Pantry {
    readonly items: readonly PantryItem[];
    readonly updatedAt: IsoDateTime | null;
}

export interface FoodSearchFilter extends CursorPageRequest {
    readonly query: string;
    readonly excludeAllergens?: readonly AllergenCode[] | undefined;
    readonly dietClassifications?: readonly DietClassification[] | undefined;
}

export interface RecipeFilter extends CursorPageRequest {
    readonly query?: string | undefined;
    readonly mealTypes?: readonly MealType[] | undefined;
    readonly cuisines?: readonly string[] | undefined;
    readonly dietClassifications?: readonly DietClassification[] | undefined;
    readonly excludeAllergens?: readonly AllergenCode[] | undefined;
    readonly energy?: NumericRangeFilter | undefined;
    readonly protein?: NumericRangeFilter | undefined;
    readonly totalMinutes?: NumericRangeFilter | undefined;
    readonly maximumComplexity?: number | undefined;
    /** Rank recipes by how much of their ingredient list the pantry already covers. */
    readonly preferPantryItems?: boolean | undefined;
    readonly kitchenId?: KitchenId | undefined;
}

export interface FoodRepository {
    /** `GET /api/v1/foods` — the logging and "add food" search. Always query-driven. */
    searchFoods(filter: FoodSearchFilter): Promise<CursorPage<Food>>;

    /** `GET /api/v1/recipes`. */
    listRecipes(filter?: RecipeFilter): Promise<CursorPage<Recipe>>;
    getRecipe(recipeId: RecipeId): Promise<Recipe>;

    /** `GET /api/v1/grocery-lists/{week}` — `week` is the Monday, `YYYY-MM-DD`. */
    getGroceryList(weekStart: string): Promise<GroceryList>;

    /** `GET /api/v1/pantry`. */
    getPantry(): Promise<Pantry>;
}
