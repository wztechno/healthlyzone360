import { amountValue } from '@healthy360/nutrition';
import type { NutritionTargetResult } from '@healthy360/nutrition';
import type {
    AllergenCode,
    CartId,
    DietitianId,
    KitchenId,
    MealId,
    MealPlanEntryId,
    MealPlanId,
    SubscriptionId,
    SubscriptionPlanId,
    UserId,
    VdSessionId,
} from '@healthy360/domain-types';

import type {
    BusinessRepository,
    CatalogueFilter,
    CatalogueItem,
    CorporateProgramme,
    Quotation,
    QuotationFilter,
    RequestQuotationRequest,
} from '../../contracts/business.ts';
import type {
    AddCartItemRequest,
    Cart,
    ChangeAddressRequest,
    ChangeSlotRequest,
    CheckoutPreview,
    CommerceRepository,
    CreateSubscriptionRequest,
    PauseSubscriptionRequest,
    PreviewCheckoutRequest,
    SkipDayRequest,
    Subscription,
    SubscriptionConfiguration,
    SubscriptionFilter,
    SubscriptionPreview,
} from '../../contracts/commerce.ts';
import { apiFailure, throwFailure } from '../../contracts/failure.ts';
import type {
    Food,
    FoodRepository,
    FoodSearchFilter,
    GroceryList,
    Pantry,
    Recipe,
    RecipeFilter,
} from '../../contracts/foods.ts';
import type {
    Dietitian,
    DietCategory,
    DietitianFilter,
    Kitchen,
    KitchenFilter,
    MarketplaceMeal,
    MarketplaceRepository,
    MealFilter,
    MealSort,
    SubscriptionPlan,
    PlanFilter,
} from '../../contracts/marketplace.ts';
import type {
    NutritionRepository,
    NutritionReview,
    RequestNutritionReviewRequest,
    StoredNutritionTarget,
    UpdateNutritionTargetRequest,
} from '../../contracts/nutrition.ts';
import type {
    CursorPage,
    CursorPageRequest,
    NumericRangeFilter,
} from '../../contracts/pagination.ts';
import type {
    AddEntryRequest,
    AdjustPortionRequest,
    DuplicatePlanRequest,
    GeneratePlanRequest,
    MealPlanDay,
    MealPlanEntry,
    MealPlanRepository,
    MealPlanSummary,
    MealPlanWeek,
    PlanHistoryEvent,
    PlanNotes,
    RegenerateScopeRequest,
    RepeatMealRequest,
    ReplaceEntryRequest,
    SaveTemplateRequest,
    SetPlanNotesRequest,
} from '../../contracts/planner.ts';
import type {
    ApproveReviewRequest,
    DietitianNote,
    ProfessionalRepository,
    RequestChangesRequest,
    ReviewDetail,
    ReviewQueueFilter,
    ReviewQueueItem,
    SetDietitianNoteRequest,
    SetOverrideRequest,
} from '../../contracts/professional.ts';
import type {
    AcceptVdProposalRequest,
    CreateVdSessionRequest,
    GenerateVdDraftRequest,
    OverrideVdProposalRequest,
    RequestVdReviewRequest,
    SendVdMessageRequest,
    VdSession,
    VdSessionSummary,
    VirtualDietitianRepository,
} from '../../contracts/virtual-dietitian.ts';
import type { MockScenarioName } from '../scenarios.ts';
import { totalRecipeMinutes } from './fixtures/index.ts';
import {
    PROTOTYPE_DIETITIANS,
    PROTOTYPE_DIET_CATEGORIES,
    PROTOTYPE_KITCHENS,
    PROTOTYPE_MEALS,
    PROTOTYPE_PLANS,
    PROTOTYPE_RECIPES,
    dietitianByKey,
    hasChannels,
    kitchenById,
} from './fixtures/index.ts';
import { PrototypeStore } from './store.ts';

/**
 * The eight prototype repositories over `PrototypeStore`.
 *
 * Everything reachable from a screen is here, and everything here is honest: the listings paginate
 * with real cursors, the filters actually filter, and every mutation reaches the store. The one
 * thing this layer adds over the store is latency — the same fixed delay the foundation's mock
 * repositories use, so screens exercise their loading states rather than resolving synchronously and
 * hiding a missing skeleton.
 */

/** Page size when the caller does not ask for one, and the ceiling when it asks for too much. */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Cursor pagination.
 *
 * The cursor is the offset, as a decimal string. It is opaque by *contract* — a client stores it and
 * sends it back, and never parses one — so the representation can become a keyset cursor on the real
 * backend without a single screen changing. An unparseable cursor restarts from the beginning rather
 * than rejecting: a stale cursor in a deep link should show the first page, not an error state.
 */
export function paginate<T>(items: readonly T[], request?: CursorPageRequest): CursorPage<T> {
    const limit = Math.min(Math.max(1, request?.limit ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const parsed = Number.parseInt(request?.cursor ?? '0', 10);
    const offset = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;

    const page = items.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    const hasMore = nextOffset < items.length;

    return {
        items: page,
        nextCursor: hasMore ? String(nextOffset) : null,
        hasMore,
        totalCount: items.length,
    };
}

function matchesText(haystack: readonly string[], query: string | undefined): boolean {
    if (query === undefined || query.trim().length === 0) return true;
    const needle = query.trim().toLowerCase();
    return haystack.some((value) => value.toLowerCase().includes(needle));
}

function inRange(value: number, range: NumericRangeFilter | undefined): boolean {
    if (range === undefined) return true;
    if (range.min !== undefined && value < range.min) return false;
    if (range.max !== undefined && value > range.max) return false;
    return true;
}

function overlaps(list: readonly string[], wanted: readonly string[] | undefined): boolean {
    if (wanted === undefined || wanted.length === 0) return true;
    return wanted.some((value) => list.includes(value));
}

function excludesAllergens(
    allergens: readonly AllergenCode[],
    excluded: readonly AllergenCode[] | undefined,
): boolean {
    if (excluded === undefined || excluded.length === 0) return true;
    return !allergens.some((code) => excluded.includes(code));
}

function compareBySort(sort: MealSort): (left: MarketplaceMeal, right: MarketplaceMeal) => number {
    switch (sort) {
        case 'price':
            return (left, right) => left.price.amount - right.price.amount;
        case 'energy':
            return (left, right) =>
                amountValue(left.nutrition, 'energy') - amountValue(right.nutrition, 'energy');
        case 'protein':
            return (left, right) =>
                amountValue(left.nutrition, 'protein') - amountValue(right.nutrition, 'protein');
        case 'rating':
            return (left, right) => (right.rating ?? 0) - (left.rating ?? 0);
        case 'preparation_time':
            return (left, right) =>
                (left.preparationMinutes ?? 0) - (right.preparationMinutes ?? 0);
        case 'relevance':
        default:
            return (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    }
}

function notFound(what: string, id: string): never {
    return throwFailure(
        apiFailure('server', {
            message: `No ${what} ${id} is published in this world.`,
            retryable: false,
        }),
    );
}

function sleep(ms: number): Promise<void> {
    return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PrototypeRepositoryBundle {
    readonly marketplace: MarketplaceRepository;
    readonly nutrition: NutritionRepository;
    readonly planner: MealPlanRepository;
    readonly foods: FoodRepository;
    readonly virtualDietitian: VirtualDietitianRepository;
    readonly commerce: CommerceRepository;
    readonly business: BusinessRepository;
    readonly professional: ProfessionalRepository;
}

export interface PrototypeRepositories extends PrototypeRepositoryBundle {
    readonly store: PrototypeStore;
}

export interface PrototypeRepositoriesOptions {
    readonly scenario?: MockScenarioName | undefined;
    readonly store?: PrototypeStore | undefined;
    readonly latencyMs?: number | undefined;
    /** Overrides the latency helper entirely; the foundation bundle threads its own in. */
    readonly settle?: (() => Promise<void>) | undefined;
    /** The professional whose actions the `professional` repository records. */
    readonly actingDietitianId?: DietitianId | undefined;
}

export function createPrototypeRepositories(
    options: PrototypeRepositoriesOptions = {},
): PrototypeRepositories {
    const store =
        options.store ??
        new PrototypeStore(options.scenario === undefined ? {} : { scenario: options.scenario });
    const latency = options.latencyMs ?? 0;
    const settle = options.settle ?? (() => sleep(latency));
    const actingDietitian = options.actingDietitianId ?? dietitianByKey('layla_haddad').id;

    /* ── marketplace ───────────────────────────────────────────────────────────────────────── */

    const marketplace: MarketplaceRepository = {
        async listKitchens(filter?: KitchenFilter): Promise<CursorPage<Kitchen>> {
            await settle();
            const matched = PROTOTYPE_KITCHENS.filter((kitchen) => {
                if (
                    !matchesText(
                        [kitchen.name, kitchen.tagline, kitchen.description, ...kitchen.cuisines],
                        filter?.query,
                    )
                ) {
                    return false;
                }
                if (
                    filter?.countryCode !== undefined &&
                    kitchen.countryCode !== filter.countryCode
                ) {
                    return false;
                }
                if (
                    filter?.area !== undefined &&
                    !kitchen.branches.some((branch) => branch.area === filter.area)
                ) {
                    return false;
                }
                if (!overlaps(kitchen.cuisines, filter?.cuisines)) return false;
                if (!overlaps(kitchen.dietClassifications, filter?.dietClassifications)) {
                    return false;
                }
                if (
                    filter?.channels !== undefined &&
                    !hasChannels(kitchen.channels, filter.channels)
                ) {
                    return false;
                }
                if (
                    filter?.deliversToZoneId !== undefined &&
                    !kitchen.branches.some((branch) =>
                        branch.deliveryZones.some((zone) => zone.id === filter.deliversToZoneId),
                    )
                ) {
                    return false;
                }
                return true;
            });
            return paginate(matched, filter);
        },

        async getKitchen(kitchenId: KitchenId): Promise<Kitchen> {
            await settle();
            return kitchenById(kitchenId) ?? notFound('kitchen', String(kitchenId));
        },

        async listMeals(filter?: MealFilter): Promise<CursorPage<MarketplaceMeal>> {
            await settle();
            const matched = PROTOTYPE_MEALS.filter((meal) => {
                // A meal is only *listed* where its kitchen is configured for the marketplace.
                // Privacy by construction, again: a wholesale kitchen has no consumer listing.
                if (!meal.channels.marketplace) return false;
                if (
                    !matchesText(
                        [meal.name, meal.description, meal.kitchenName, ...meal.cuisines],
                        filter?.query,
                    )
                ) {
                    return false;
                }
                if (
                    filter?.kitchenIds !== undefined &&
                    filter.kitchenIds.length > 0 &&
                    !filter.kitchenIds.includes(meal.kitchenId)
                ) {
                    return false;
                }
                if (!overlaps(meal.mealTypes, filter?.mealTypes)) return false;
                if (!overlaps(meal.dietClassifications, filter?.dietClassifications)) return false;
                if (!overlaps(meal.cuisines, filter?.cuisines)) return false;
                if (!excludesAllergens(meal.allergens, filter?.excludeAllergens)) return false;
                if (!inRange(amountValue(meal.nutrition, 'energy'), filter?.energy)) return false;
                if (!inRange(amountValue(meal.nutrition, 'protein'), filter?.protein)) return false;
                if (!inRange(amountValue(meal.nutrition, 'carbohydrate'), filter?.carbohydrate)) {
                    return false;
                }
                if (!inRange(amountValue(meal.nutrition, 'fat'), filter?.fat)) return false;
                if (!inRange(meal.price.amount, filter?.price)) return false;
                if (
                    filter?.preparationMinutes !== undefined &&
                    !inRange(meal.preparationMinutes ?? 0, filter.preparationMinutes)
                ) {
                    return false;
                }
                if (filter?.availableOn !== undefined) {
                    const day = meal.availability.find(
                        (window) => window.date === filter.availableOn,
                    );
                    if (day === undefined || !day.available) return false;
                }
                return true;
            });

            const sorted = matched.slice().sort(compareBySort(filter?.sort ?? 'relevance'));
            if (filter?.direction === 'desc') sorted.reverse();
            return paginate(sorted, filter);
        },

        async getMeal(mealId: MealId): Promise<MarketplaceMeal> {
            await settle();
            return (
                PROTOTYPE_MEALS.find((meal) => meal.id === mealId) ??
                notFound('marketplace meal', String(mealId))
            );
        },

        async listPlans(filter?: PlanFilter): Promise<CursorPage<SubscriptionPlan>> {
            await settle();
            const matched = PROTOTYPE_PLANS.filter((plan) => {
                if (!matchesText([plan.name, plan.summary, plan.description], filter?.query)) {
                    return false;
                }
                if (
                    filter?.kitchenIds !== undefined &&
                    filter.kitchenIds.length > 0 &&
                    !filter.kitchenIds.includes(plan.kitchenId)
                ) {
                    return false;
                }
                if (
                    filter?.categorySlug !== undefined &&
                    !plan.categorySlugs.includes(filter.categorySlug)
                ) {
                    return false;
                }
                if (!overlaps(plan.dietClassifications, filter?.dietClassifications)) return false;
                if (
                    filter?.duration !== undefined &&
                    !plan.durations.some((option) => option.duration === filter.duration)
                ) {
                    return false;
                }
                if (
                    filter?.mealsPerDay !== undefined &&
                    !plan.variants.some((variant) => variant.mealsPerDay === filter.mealsPerDay)
                ) {
                    return false;
                }
                if (filter?.energy !== undefined) {
                    // A plan matches an energy filter when *any* of its variants overlaps the band.
                    const overlapsEnergy = plan.variants.some(
                        (variant) =>
                            (filter.energy?.min === undefined ||
                                variant.energyRange.max >= filter.energy.min) &&
                            (filter.energy?.max === undefined ||
                                variant.energyRange.min <= filter.energy.max),
                    );
                    if (!overlapsEnergy) return false;
                }
                return true;
            });
            return paginate(matched, filter);
        },

        async getPlan(planId: SubscriptionPlanId): Promise<SubscriptionPlan> {
            await settle();
            return (
                PROTOTYPE_PLANS.find((plan) => plan.id === planId) ??
                notFound('subscription plan', String(planId))
            );
        },

        async listDietitians(filter?: DietitianFilter): Promise<CursorPage<Dietitian>> {
            await settle();
            const matched = PROTOTYPE_DIETITIANS.filter((dietitian) => {
                if (
                    !matchesText(
                        [dietitian.displayName, dietitian.headline, ...dietitian.specialisms],
                        filter?.query,
                    )
                ) {
                    return false;
                }
                if (
                    filter?.specialism !== undefined &&
                    !dietitian.specialisms.includes(filter.specialism)
                ) {
                    return false;
                }
                if (filter?.locale !== undefined && !dietitian.locales.includes(filter.locale)) {
                    return false;
                }
                if (
                    filter?.countryCode !== undefined &&
                    dietitian.countryCode !== filter.countryCode
                ) {
                    return false;
                }
                if (
                    filter?.acceptingClients !== undefined &&
                    dietitian.acceptingClients !== filter.acceptingClients
                ) {
                    return false;
                }
                return true;
            });
            return paginate(matched, filter);
        },

        async getDietitian(dietitianId: DietitianId): Promise<Dietitian> {
            await settle();
            return (
                PROTOTYPE_DIETITIANS.find((dietitian) => dietitian.id === dietitianId) ??
                notFound('dietitian', String(dietitianId))
            );
        },

        async listDietCategories(): Promise<readonly DietCategory[]> {
            await settle();
            return PROTOTYPE_DIET_CATEGORIES;
        },
    };

    /* ── nutrition ─────────────────────────────────────────────────────────────────────────── */

    const nutrition: NutritionRepository = {
        async calculateTargets(request): Promise<NutritionTargetResult> {
            await settle();
            return store.calculateTargets(request);
        },

        async getCurrentTargets(): Promise<StoredNutritionTarget | null> {
            await settle();
            return store.currentTargets();
        },

        async updateCurrentTargets(
            request: UpdateNutritionTargetRequest,
        ): Promise<StoredNutritionTarget> {
            await settle();
            return store.updateTargets(request);
        },

        async requestReview(request: RequestNutritionReviewRequest): Promise<NutritionReview> {
            await settle();
            return store.requestNutritionReview(request);
        },
    };

    /* ── planner ───────────────────────────────────────────────────────────────────────────── */

    const planner: MealPlanRepository = {
        async listPlans(request?: CursorPageRequest): Promise<CursorPage<MealPlanSummary>> {
            await settle();
            return paginate(store.listPlans(), request);
        },

        async getCurrentPlan(): Promise<MealPlanSummary | null> {
            await settle();
            const [current] = store.listPlans();
            return current ?? null;
        },

        async getWeek(planId: MealPlanId, weekStart: string): Promise<MealPlanWeek> {
            await settle();
            return store.getWeek(planId, weekStart);
        },

        async getDay(planId: MealPlanId, date: string): Promise<MealPlanDay> {
            await settle();
            return store.getDay(planId, date);
        },

        async generate(request: GeneratePlanRequest): Promise<MealPlanWeek> {
            await settle();
            return store.generate(request);
        },

        async regenerateWeek(
            planId: MealPlanId,
            request?: RegenerateScopeRequest,
        ): Promise<MealPlanWeek> {
            await settle();
            return store.regenerateWeek(planId, request);
        },

        async regenerateDay(
            planId: MealPlanId,
            date: string,
            request?: RegenerateScopeRequest,
        ): Promise<MealPlanDay> {
            await settle();
            return store.regenerateDay(planId, date, request);
        },

        async regenerateEntry(
            planId: MealPlanId,
            entryId: MealPlanEntryId,
            request?: RegenerateScopeRequest,
        ): Promise<MealPlanEntry> {
            await settle();
            return store.regenerateEntry(planId, entryId, request);
        },

        async lockEntry(planId: MealPlanId, entryId: MealPlanEntryId): Promise<MealPlanEntry> {
            await settle();
            return store.lockEntry(planId, entryId);
        },

        async unlockEntry(planId: MealPlanId, entryId: MealPlanEntryId): Promise<MealPlanEntry> {
            await settle();
            return store.unlockEntry(planId, entryId);
        },

        async replaceEntry(
            planId: MealPlanId,
            entryId: MealPlanEntryId,
            request: ReplaceEntryRequest,
        ): Promise<readonly MealPlanEntry[]> {
            await settle();
            return store.replaceEntry(planId, entryId, request);
        },

        async adjustPortion(
            planId: MealPlanId,
            entryId: MealPlanEntryId,
            request: AdjustPortionRequest,
        ): Promise<MealPlanEntry> {
            await settle();
            return store.adjustPortion(planId, entryId, request);
        },

        async addEntry(planId: MealPlanId, request: AddEntryRequest): Promise<MealPlanEntry> {
            await settle();
            return store.addEntry(planId, request);
        },

        async removeEntry(planId: MealPlanId, entryId: MealPlanEntryId): Promise<void> {
            await settle();
            store.removeEntry(planId, entryId);
        },

        async repeatMeal(
            planId: MealPlanId,
            request: RepeatMealRequest,
        ): Promise<readonly MealPlanEntry[]> {
            await settle();
            return store.repeatMeal(planId, request);
        },

        async getNotes(planId: MealPlanId): Promise<PlanNotes> {
            await settle();
            return store.getNotes(planId);
        },

        async setNotes(planId: MealPlanId, request: SetPlanNotesRequest): Promise<PlanNotes> {
            await settle();
            return store.setNotes(planId, request);
        },

        async history(
            planId: MealPlanId,
            request?: CursorPageRequest,
        ): Promise<CursorPage<PlanHistoryEvent>> {
            await settle();
            return paginate(store.history(planId), request);
        },

        async saveAsTemplate(
            planId: MealPlanId,
            request: SaveTemplateRequest,
        ): Promise<MealPlanSummary> {
            await settle();
            return store.saveAsTemplate(planId, request);
        },

        async duplicate(planId: MealPlanId, request: DuplicatePlanRequest): Promise<MealPlanWeek> {
            await settle();
            return store.duplicate(planId, request);
        },
    };

    /* ── foods ─────────────────────────────────────────────────────────────────────────────── */

    const foods: FoodRepository = {
        async searchFoods(filter: FoodSearchFilter): Promise<CursorPage<Food>> {
            await settle();
            const matched = store.foods().filter((food) => {
                if (!matchesText([food.name], filter.query)) return false;
                if (!excludesAllergens(food.allergens, filter.excludeAllergens)) return false;
                if (!overlaps(food.dietClassifications, filter.dietClassifications)) return false;
                return true;
            });
            return paginate(matched, filter);
        },

        async listRecipes(filter?: RecipeFilter): Promise<CursorPage<Recipe>> {
            await settle();
            const pantryIds = new Set(store.pantry().items.map((item) => item.ingredientId));

            const matched = PROTOTYPE_RECIPES.filter((recipe) => {
                if (
                    !matchesText(
                        [recipe.name, recipe.description, ...recipe.cuisines],
                        filter?.query,
                    )
                ) {
                    return false;
                }
                if (!overlaps(recipe.mealTypes, filter?.mealTypes)) return false;
                if (!overlaps(recipe.cuisines, filter?.cuisines)) return false;
                if (!overlaps(recipe.dietClassifications, filter?.dietClassifications))
                    return false;
                if (!excludesAllergens(recipe.allergens, filter?.excludeAllergens)) return false;
                if (!inRange(amountValue(recipe.nutrition.perServing, 'energy'), filter?.energy)) {
                    return false;
                }
                if (
                    !inRange(amountValue(recipe.nutrition.perServing, 'protein'), filter?.protein)
                ) {
                    return false;
                }
                if (!inRange(totalRecipeMinutes(recipe), filter?.totalMinutes)) return false;
                if (
                    filter?.maximumComplexity !== undefined &&
                    recipe.complexity > filter.maximumComplexity
                ) {
                    return false;
                }
                if (filter?.kitchenId !== undefined && recipe.kitchenId !== filter.kitchenId) {
                    return false;
                }
                return true;
            });

            const ordered =
                filter?.preferPantryItems === true
                    ? matched
                          .slice()
                          .sort(
                              (left, right) =>
                                  pantryCoverage(right, pantryIds) -
                                  pantryCoverage(left, pantryIds),
                          )
                    : matched;

            return paginate(ordered, filter);
        },

        async getRecipe(recipeId): Promise<Recipe> {
            await settle();
            return store.recipe(recipeId);
        },

        async getGroceryList(weekStart: string): Promise<GroceryList> {
            await settle();
            return store.groceryList(weekStart);
        },

        async getPantry(): Promise<Pantry> {
            await settle();
            return store.pantry();
        },
    };

    /* ── virtual dietitian ─────────────────────────────────────────────────────────────────── */

    const virtualDietitian: VirtualDietitianRepository = {
        async createSession(request?: CreateVdSessionRequest): Promise<VdSession> {
            await settle();
            return store.createVdSession(request);
        },

        async getSession(sessionId: VdSessionId): Promise<VdSession> {
            await settle();
            return store.vdSession(sessionId);
        },

        async listSessions(request?: CursorPageRequest): Promise<CursorPage<VdSessionSummary>> {
            await settle();
            const summaries: readonly VdSessionSummary[] = store.vdSessions().map((session) => ({
                id: session.id,
                state: session.state,
                headline: headlineFor(session),
                updatedAt: session.updatedAt,
            }));
            return paginate(summaries, request);
        },

        async sendMessage(
            sessionId: VdSessionId,
            request: SendVdMessageRequest,
        ): Promise<VdSession> {
            await settle();
            return store.sendVdMessage(sessionId, request);
        },

        async generateDraft(
            sessionId: VdSessionId,
            request: GenerateVdDraftRequest,
        ): Promise<VdSession> {
            await settle();
            return store.generateVdDraft(sessionId, request);
        },

        async requestReview(
            sessionId: VdSessionId,
            request?: RequestVdReviewRequest,
        ): Promise<VdSession> {
            await settle();
            return store.requestVdReview(sessionId, request);
        },

        async acceptProposal(
            sessionId: VdSessionId,
            request: AcceptVdProposalRequest,
        ): Promise<VdSession> {
            await settle();
            return store.acceptVdProposal(sessionId, request);
        },

        async overrideProposal(
            sessionId: VdSessionId,
            request: OverrideVdProposalRequest,
        ): Promise<VdSession> {
            await settle();
            return store.overrideVdProposal(sessionId, request, actingDietitian);
        },
    };

    /* ── commerce ──────────────────────────────────────────────────────────────────────────── */

    const commerce: CommerceRepository = {
        async getCart(): Promise<Cart> {
            await settle();
            return store.cart();
        },

        async addCartItem(cartId: CartId, request: AddCartItemRequest): Promise<Cart> {
            await settle();
            return store.addCartItem(
                cartId,
                request.mealId,
                request.quantity,
                request.deliveryDate,
            );
        },

        async removeCartItem(cartId: CartId, itemId: string): Promise<Cart> {
            await settle();
            return store.removeCartItem(cartId, itemId);
        },

        async previewCheckout(request: PreviewCheckoutRequest): Promise<CheckoutPreview> {
            await settle();
            return store.previewCheckout(request);
        },

        async previewSubscription(
            configuration: SubscriptionConfiguration,
        ): Promise<SubscriptionPreview> {
            await settle();
            return store.previewSubscription(configuration);
        },

        async createSubscription(request: CreateSubscriptionRequest): Promise<Subscription> {
            await settle();
            return store.createSubscription(request);
        },

        async getSubscription(subscriptionId: SubscriptionId): Promise<Subscription> {
            await settle();
            return store.subscription(subscriptionId);
        },

        async listSubscriptions(filter?: SubscriptionFilter): Promise<CursorPage<Subscription>> {
            await settle();
            const matched = store
                .subscriptions()
                .filter(
                    (subscription) =>
                        filter?.states === undefined ||
                        filter.states.length === 0 ||
                        filter.states.includes(subscription.state),
                );
            return paginate(matched, filter);
        },

        async pause(
            subscriptionId: SubscriptionId,
            request?: PauseSubscriptionRequest,
        ): Promise<Subscription> {
            await settle();
            return store.pauseSubscription(subscriptionId, request);
        },

        async resume(subscriptionId: SubscriptionId): Promise<Subscription> {
            await settle();
            return store.resumeSubscription(subscriptionId);
        },

        async skipDay(
            subscriptionId: SubscriptionId,
            request: SkipDayRequest,
        ): Promise<Subscription> {
            await settle();
            return store.skipDay(subscriptionId, request);
        },

        async changeAddress(
            subscriptionId: SubscriptionId,
            request: ChangeAddressRequest,
        ): Promise<Subscription> {
            await settle();
            return store.changeAddress(subscriptionId, request);
        },

        async changeSlot(
            subscriptionId: SubscriptionId,
            request: ChangeSlotRequest,
        ): Promise<Subscription> {
            await settle();
            return store.changeSlot(subscriptionId, request);
        },
    };

    /* ── business ──────────────────────────────────────────────────────────────────────────── */

    const business: BusinessRepository = {
        async getCorporateProgramme(programmeId): Promise<CorporateProgramme> {
            await settle();
            return store.programme(programmeId);
        },

        async listCatalogue(filter: CatalogueFilter): Promise<CursorPage<CatalogueItem>> {
            await settle();
            const matched = store.catalogue(filter.programmeId).filter((item) => {
                if (!matchesText([item.name, item.description], filter.query)) return false;
                if (
                    filter.kinds !== undefined &&
                    filter.kinds.length > 0 &&
                    !filter.kinds.includes(item.kind)
                ) {
                    return false;
                }
                if (
                    filter.kitchenIds !== undefined &&
                    filter.kitchenIds.length > 0 &&
                    !filter.kitchenIds.includes(item.kitchenId)
                ) {
                    return false;
                }
                return true;
            });
            return paginate(matched, filter);
        },

        async getCatalogueItem(itemId: string): Promise<CatalogueItem> {
            await settle();
            return store.catalogueItem(itemId);
        },

        async requestQuotation(request: RequestQuotationRequest): Promise<Quotation> {
            await settle();
            return store.requestQuotation(request);
        },

        async listQuotations(filter?: QuotationFilter): Promise<CursorPage<Quotation>> {
            await settle();
            const matched = store.quotations().filter((quotation) => {
                if (
                    filter?.programmeId !== undefined &&
                    quotation.programmeId !== filter.programmeId
                ) {
                    return false;
                }
                if (
                    filter?.states !== undefined &&
                    filter.states.length > 0 &&
                    !filter.states.includes(quotation.state)
                ) {
                    return false;
                }
                return true;
            });
            return paginate(matched, filter);
        },
    };

    /* ── professional ──────────────────────────────────────────────────────────────────────── */

    const professional: ProfessionalRepository = {
        async listReviewQueue(filter?: ReviewQueueFilter): Promise<CursorPage<ReviewQueueItem>> {
            await settle();
            const matched = store.reviewQueue().filter((item) => {
                if (
                    filter?.states !== undefined &&
                    filter.states.length > 0 &&
                    !filter.states.includes(item.state)
                ) {
                    return false;
                }
                if (
                    filter?.subjects !== undefined &&
                    filter.subjects.length > 0 &&
                    !filter.subjects.includes(item.subject)
                ) {
                    return false;
                }
                if (filter?.priority !== undefined && item.priority !== filter.priority) {
                    return false;
                }
                if (filter?.assignedToMe === true && item.assignedTo !== actingDietitian) {
                    return false;
                }
                return true;
            });
            return paginate(matched, filter);
        },

        async getReview(reviewId: string): Promise<ReviewDetail> {
            await settle();
            return store.review(reviewId);
        },

        async approve(reviewId: string, request: ApproveReviewRequest): Promise<ReviewQueueItem> {
            await settle();
            return store.approveReview(reviewId, request);
        },

        async requestChanges(
            reviewId: string,
            request: RequestChangesRequest,
        ): Promise<ReviewQueueItem> {
            await settle();
            return store.requestReviewChanges(reviewId, request);
        },

        async getClientPlan(
            _clientId: UserId,
            planId: MealPlanId,
            weekStart: string,
        ): Promise<MealPlanWeek> {
            await settle();
            return store.getWeek(planId, weekStart);
        },

        async setDietitianNote(request: SetDietitianNoteRequest): Promise<DietitianNote> {
            await settle();
            return store.setDietitianNote(request, actingDietitian);
        },

        async setOverride(request: SetOverrideRequest): Promise<StoredNutritionTarget> {
            await settle();
            return store.setOverride(request, actingDietitian);
        },
    };

    return {
        store,
        marketplace,
        nutrition,
        planner,
        foods,
        virtualDietitian,
        commerce,
        business,
        professional,
    };
}

/** Proportion of a recipe's ingredients the pantry already covers, 0–1. */
function pantryCoverage(recipe: Recipe, pantryIds: ReadonlySet<string>): number {
    if (recipe.ingredients.length === 0) return 0;
    const covered = recipe.ingredients.filter((line) => pantryIds.has(line.ingredientId)).length;
    return covered / recipe.ingredients.length;
}

/** A one-line summary of a session, for the list. Derived from the state, never from a message. */
function headlineFor(session: VdSession): string {
    const headlines: Readonly<Record<string, string>> = {
        initial_interview: 'Interview started',
        analysing: 'Working through your answers',
        missing_information: 'One thing is missing',
        suggested_targets: 'Targets suggested',
        suggested_meal_structure: 'Meal structure suggested',
        draft_generated: 'Draft week ready',
        review_requested: 'With a dietitian',
        professionally_approved: 'Approved by a dietitian',
        generation_failed: 'Could not generate a week',
        restriction_conflict: 'Restrictions conflict',
        no_suitable_meals: 'No suitable meals nearby',
        safety_escalation: 'Handed to a person',
    };
    return headlines[session.state] ?? 'Virtual Dietitian session';
}
