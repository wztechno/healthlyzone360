/**
 * The prototype fixture world.
 *
 * **Nothing outside `packages/api-client/src/mock/prototype/` should import this barrel.** Screens
 * reach data through repositories; a screen that imports a fixture has bound itself to the mock and
 * will break the day it is handed the API bundle instead. The rule is enforced by an ESLint
 * restriction on mock imports from application code, and the package root deliberately re-exports
 * none of it.
 *
 * The store (`../store.ts`) and the repositories (`../repositories.ts`) are the intended consumers.
 */

export {
    PROTOTYPE_ALLERGENS,
    PROTOTYPE_ALLERGEN_CODES,
    allergenCode,
    prototypeAllergen,
    unionAllergens,
} from './allergens.ts';
export type { PrototypeAllergen } from './allergens.ts';

export {
    MANDATORY_NUTRIENT_IDS,
    OPTIONAL_NUTRIENT_IDS,
    PROTOTYPE_NUTRIENT_DEFINITIONS,
    makeAmount,
    makeFacts,
    makeServing,
    makeSyntheticCalculation,
    nutrientDefinitionAt,
    prototypeNutrientDefinition,
} from './nutrients.ts';

export {
    INGREDIENT_SUITABILITIES,
    PROTOTYPE_INGREDIENTS,
    ingredientAt,
    ingredientByKey,
    ingredientById,
    ingredientCost,
    makeIngredient,
    makeIngredientQuantity,
} from './ingredients.ts';
export type { IngredientSuitability, PrototypeIngredient } from './ingredients.ts';

export {
    CHANNEL_ORDER,
    MARKETPLACE_KITCHEN_KEYS,
    PROTOTYPE_DELIVERY_ZONES,
    PROTOTYPE_KITCHENS,
    PROTOTYPE_KITCHEN_BRANCHES,
    PROTOTYPE_KITCHEN_IDS,
    deliveryZoneByKey,
    deliveryZoneById,
    hasChannels,
    kitchenByKey,
    kitchenById,
    makeChannels,
    makeDeliveryZone,
    makeKitchen,
    makeKitchenBranch,
    makeOpeningHours,
} from './kitchens.ts';

export {
    HOME_RECIPES,
    PROTOTYPE_RECIPES,
    PROTOTYPE_RECIPE_VERSION,
    makeRecipe,
    recipeAt,
    recipeByKey,
    recipeById,
    totalRecipeMinutes,
} from './recipes.ts';

export {
    MEAL_RECIPE_INDEX,
    PROTOTYPE_MEALS,
    makeAvailability,
    makeMarketplaceMeal,
    mealAt,
    mealByKey,
    mealById,
    mealsForKitchen,
    mealsForType,
} from './meals.ts';

export {
    DURATION_DISCOUNT_PERCENT,
    PLAN_DELIVERY_WEEKDAYS,
    PROTOTYPE_PLANS,
    PROTOTYPE_PLAN_VARIANTS,
    deliveryWeekdaysFor,
    makeDurationOptions,
    makePlanVariant,
    makeSubscriptionPlan,
    planAt,
    planByKey,
    planById,
    planVariantById,
} from './plans.ts';

export {
    PROTOTYPE_DIETITIANS,
    PROTOTYPE_DIET_CATEGORIES,
    dietCategoryBySlug,
    dietitianByKey,
    dietitianById,
    makeDietCategory,
    makeDietitian,
} from './dietitians.ts';

export {
    PROTOTYPE_CONSTRAINTS,
    PROTOTYPE_CUSTOMER_ID,
    PROTOTYPE_CUSTOMER_NAME,
    PROTOTYPE_DAILY_TARGET_FACTS,
    PROTOTYPE_NUTRIENT_TARGETS,
    PROTOTYPE_ONBOARDING,
    PROTOTYPE_ONBOARDING_STEP_COUNT,
    PROTOTYPE_STORED_TARGET,
    PROTOTYPE_TARGET_ENGINE,
    PROTOTYPE_TARGET_REQUEST,
    PROTOTYPE_TARGET_RESULT,
    PROTOTYPE_WEEKLY_TARGET_FACTS,
    constraintOfKind,
    makeConstraint,
    makeOnboardingAnswers,
    makeStoredTarget,
    makeTargetRequest,
    nutrientTargetsFor,
    targetFactsFor,
} from './customer.ts';
export type { OnboardingMealSlot, PrototypeOnboardingAnswers } from './customer.ts';

export {
    ALLERGEN_WARNING_CODE,
    ENERGY_WARNING_CODE,
    ENTRY_ENERGY_WARNING_SHARE,
    PROTOTYPE_GROCERY_LIST,
    PROTOTYPE_PANTRY,
    PROTOTYPE_PLAN_IDS,
    PROTOTYPE_WEEK_ENTRIES,
    PROTOTYPE_WEEK_ENTRY_COUNT,
    buildDay,
    buildGroceryList,
    buildWeek,
    compareEntries,
    deriveEntryWarnings,
    entryOccasion,
    makeEntry,
    makePantry,
    makeWeekEntries,
    weekEntryAt,
} from './planner.ts';
export type { MakeEntryOptions } from './planner.ts';

export {
    PROTOTYPE_VD_APPROVED_SESSION,
    PROTOTYPE_VD_CONVERSATION,
    PROTOTYPE_VD_SESSIONS,
    VD_ALLERGEN_NOTICE,
    VD_ASSISTANT_SCRIPT,
    VD_CONFLICT_FIXTURE,
    VD_COVERED_STATES,
    VD_DISCLAIMER,
    VD_ESCALATION_NOTICE,
    VD_MISSING_INFORMATION_FIXTURES,
    VD_PROGRESSION,
    VD_SAFETY_MARKERS,
    detectSafetyMarker,
    makeMealStructure,
    makeVdMessage,
    makeVdProposal,
    makeVdSession,
    vdSessionAt,
    vdSessionForState,
} from './virtual-dietitian.ts';

export {
    PROTOTYPE_BUYER_ORGANISATION_IDS,
    PROTOTYPE_CATALOGUE_ITEMS,
    PROTOTYPE_PROGRAMMES,
    PROTOTYPE_QUOTATIONS,
    QUOTATION_REFERENCE_PREFIX,
    SAR_CATALOGUE_ITEM_ID,
    catalogueItemById,
    catalogueItemsForProgramme,
    makeCatalogueItem,
    makeCorporateProgramme,
    makeQuotation,
    makeVolumeTier,
    programmeByKey,
    programmeById,
    quotationById,
} from './business.ts';

export {
    PROTOTYPE_CLIENT_NOTE,
    PROTOTYPE_DIETITIAN_NOTE,
    PROTOTYPE_REVIEW_CONTEXT,
    PROTOTYPE_REVIEW_QUEUE,
    makeDietitianNote,
    makeReviewQueueItem,
    reviewQueueItemAt,
} from './professional.ts';
