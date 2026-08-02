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
    AllergenClass,
    BranchOperating,
    DeliveryZoneAdmin,
    DeliveryZoneAdminFilter,
    IngredientAdmin,
    IngredientAdminFilter,
    KitchenAdminRepository,
    MealAdmin,
    MealAdminFilter,
    PlanAdmin,
    PlanAdminFilter,
    PriceListAdmin,
    PriceListAdminFilter,
    ProductAdmin,
    ProductAdminFilter,
    PublishableStatus,
    RecipeAdmin,
    RecipeAdminFilter,
    RecipeAdminSummary,
    RecipeRollupPreview,
    ServiceArea,
    ServiceAreaFilter,
} from '../../contracts/kitchen-admin.ts';
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
    dietitianByKey,
    hasChannels,
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
    readonly kitchenAdmin: KitchenAdminRepository;
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
            const matched = store.kitchens().filter((kitchen) => {
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
            return store.kitchen(kitchenId) ?? notFound('kitchen', String(kitchenId));
        },

        async listMeals(filter?: MealFilter): Promise<CursorPage<MarketplaceMeal>> {
            await settle();
            const matched = store.meals().filter((meal) => {
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
            return store.meal(mealId) ?? notFound('marketplace meal', String(mealId));
        },

        async listPlans(filter?: PlanFilter): Promise<CursorPage<SubscriptionPlan>> {
            await settle();
            const matched = store.marketplacePlans().filter((plan) => {
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
            return store.marketplacePlan(planId) ?? notFound('subscription plan', String(planId));
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

            const matched = store.recipes().filter((recipe) => {
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

    /* ── kitchen management ────────────────────────────────────────────────────────────────── */

    /**
     * The management surface, over the *same* catalogue the marketplace repository above reads.
     *
     * That is the whole point of the store refactor: publishing a meal here makes it appear in
     * `marketplace.listMeals`, retiring one removes it, and editing a branch's opening hours changes
     * what `getKitchen` reports — because there is one collection, not two.
     */
    const kitchenAdmin: KitchenAdminRepository = {
        async listAllergenClasses(): Promise<readonly AllergenClass[]> {
            await settle();
            return store.kitchenCatalogue.allergenClasses();
        },
        async listServiceAreas(filter?: ServiceAreaFilter): Promise<CursorPage<ServiceArea>> {
            await settle();
            const matched = store.kitchenCatalogue.serviceAreas().filter((area) => {
                if (!matchesText([area.name.en, area.name.ar], filter?.query)) return false;
                if (filter?.countryCode !== undefined && area.countryCode !== filter.countryCode) {
                    return false;
                }
                return true;
            });
            return paginate(matched, filter);
        },

        async listIngredients(
            filter?: IngredientAdminFilter,
        ): Promise<CursorPage<IngredientAdmin>> {
            await settle();
            const matched = store.kitchenCatalogue.listIngredients().filter((row) => {
                if (!matchesText([row.name.en, row.name.ar, ...row.aliases], filter?.query)) {
                    return false;
                }
                if (!hasStatus(row.meta.status, filter?.statuses)) return false;
                if (
                    filter?.categoryCode !== undefined &&
                    row.categoryCode !== filter.categoryCode
                ) {
                    return false;
                }
                if (
                    filter?.allergenCodes !== undefined &&
                    filter.allergenCodes.length > 0 &&
                    !row.allergens.some((mapping) =>
                        filter.allergenCodes?.includes(mapping.allergenCode),
                    )
                ) {
                    return false;
                }
                if (filter?.ownedOnly === true && row.organisationId === null) return false;
                return true;
            });
            return paginate(matched, filter);
        },
        async getIngredient(ingredientId): Promise<IngredientAdmin> {
            await settle();
            return store.kitchenCatalogue.getIngredient(ingredientId);
        },
        async createIngredient(request): Promise<IngredientAdmin> {
            await settle();
            return store.kitchenCatalogue.createIngredient(request);
        },
        async updateIngredient(ingredientId, request): Promise<IngredientAdmin> {
            await settle();
            return store.kitchenCatalogue.updateIngredient(ingredientId, request);
        },
        async archiveIngredient(ingredientId, request): Promise<IngredientAdmin> {
            await settle();
            return store.kitchenCatalogue.archiveIngredient(ingredientId, request);
        },
        async setIngredientAllergens(ingredientId, request): Promise<IngredientAdmin> {
            await settle();
            return store.kitchenCatalogue.setIngredientAllergens(ingredientId, request);
        },

        async listRecipes(filter?: RecipeAdminFilter): Promise<CursorPage<RecipeAdminSummary>> {
            await settle();
            const matched = store.kitchenCatalogue.listRecipes().filter((row) => {
                if (!matchesText([row.name.en, row.name.ar, row.slug], filter?.query)) return false;
                if (!hasStatus(row.meta.status, filter?.statuses)) return false;
                if (filter?.kitchenId !== undefined && row.kitchenId !== filter.kitchenId) {
                    return false;
                }
                return true;
            });
            return paginate(matched, filter);
        },
        async getRecipe(recipeId): Promise<RecipeAdmin> {
            await settle();
            return store.kitchenCatalogue.getRecipe(recipeId);
        },
        async createRecipe(request): Promise<RecipeAdmin> {
            await settle();
            return store.kitchenCatalogue.createRecipe(request);
        },
        async updateRecipe(recipeId, request): Promise<RecipeAdmin> {
            await settle();
            return store.kitchenCatalogue.updateRecipe(recipeId, request);
        },
        async setRecipeLines(recipeId, request): Promise<RecipeAdmin> {
            await settle();
            return store.kitchenCatalogue.setRecipeLines(recipeId, request);
        },
        async setRecipeSteps(recipeId, request): Promise<RecipeAdmin> {
            await settle();
            return store.kitchenCatalogue.setRecipeSteps(recipeId, request);
        },
        async setRecipeOutputs(recipeId, request): Promise<RecipeAdmin> {
            await settle();
            return store.kitchenCatalogue.setRecipeOutputs(recipeId, request);
        },
        async previewRecipeRollup(draft): Promise<RecipeRollupPreview> {
            await settle();
            return store.kitchenCatalogue.previewRecipeRollup(draft);
        },
        async publishRecipe(recipeId, request): Promise<RecipeAdmin> {
            await settle();
            return store.kitchenCatalogue.publishRecipe(recipeId, request);
        },
        async retireRecipe(recipeId, request): Promise<RecipeAdmin> {
            await settle();
            return store.kitchenCatalogue.retireRecipe(recipeId, request);
        },

        async listProducts(filter?: ProductAdminFilter): Promise<CursorPage<ProductAdmin>> {
            await settle();
            const matched = store.kitchenCatalogue.listProducts().filter((row) => {
                if (!matchesText([row.name.en, row.name.ar], filter?.query)) return false;
                if (!hasStatus(row.meta.status, filter?.statuses)) return false;
                if (
                    filter?.categoryCode !== undefined &&
                    row.categoryCode !== filter.categoryCode
                ) {
                    return false;
                }
                if (
                    filter?.channels !== undefined &&
                    filter.channels.length > 0 &&
                    !row.channelAvailability.some(
                        (entry) => entry.isAvailable && filter.channels?.includes(entry.channel),
                    )
                ) {
                    return false;
                }
                return true;
            });
            return paginate(matched, filter);
        },
        async getProduct(productId): Promise<ProductAdmin> {
            await settle();
            return store.kitchenCatalogue.getProduct(productId);
        },
        async createProduct(request): Promise<ProductAdmin> {
            await settle();
            return store.kitchenCatalogue.createProduct(request);
        },
        async updateProduct(productId, request): Promise<ProductAdmin> {
            await settle();
            return store.kitchenCatalogue.updateProduct(productId, request);
        },
        async archiveProduct(productId, request): Promise<ProductAdmin> {
            await settle();
            return store.kitchenCatalogue.archiveProduct(productId, request);
        },
        async setProductChannelAvailability(productId, request): Promise<ProductAdmin> {
            await settle();
            return store.kitchenCatalogue.setProductChannelAvailability(productId, request);
        },

        async listPriceLists(filter?: PriceListAdminFilter): Promise<CursorPage<PriceListAdmin>> {
            await settle();
            const matched = store.kitchenCatalogue.listPriceLists().filter((row) => {
                if (!matchesText([row.name.en, row.name.ar], filter?.query)) return false;
                if (!hasStatus(row.meta.status, filter?.statuses)) return false;
                if (filter?.currency !== undefined && row.currency !== filter.currency)
                    return false;
                if (
                    filter?.channels !== undefined &&
                    filter.channels.length > 0 &&
                    !row.channels.some((channel) => filter.channels?.includes(channel))
                ) {
                    return false;
                }
                return true;
            });
            return paginate(matched, filter);
        },
        async getPriceList(priceListId): Promise<PriceListAdmin> {
            await settle();
            return store.kitchenCatalogue.getPriceList(priceListId);
        },
        async setPriceListEntries(priceListId, request): Promise<PriceListAdmin> {
            await settle();
            return store.kitchenCatalogue.setPriceListEntries(priceListId, request);
        },
        async publishPriceList(priceListId, request): Promise<PriceListAdmin> {
            await settle();
            return store.kitchenCatalogue.publishPriceList(priceListId, request);
        },

        async listMeals(filter?: MealAdminFilter): Promise<CursorPage<MealAdmin>> {
            await settle();
            const matched = store.kitchenCatalogue.listMeals().filter((row) => {
                if (!matchesText([row.name.en, row.name.ar], filter?.query)) return false;
                if (!hasStatus(row.meta.status, filter?.statuses)) return false;
                if (filter?.kitchenId !== undefined && row.kitchenId !== filter.kitchenId) {
                    return false;
                }
                if (!overlaps(row.mealTypes, filter?.mealTypes)) return false;
                return true;
            });
            return paginate(matched, filter);
        },
        async getMeal(mealId): Promise<MealAdmin> {
            await settle();
            return store.kitchenCatalogue.getMeal(mealId);
        },
        async createMeal(request): Promise<MealAdmin> {
            await settle();
            return store.kitchenCatalogue.createMeal(request);
        },
        async updateMeal(mealId, request): Promise<MealAdmin> {
            await settle();
            return store.kitchenCatalogue.updateMeal(mealId, request);
        },
        async publishMeal(mealId, request): Promise<MealAdmin> {
            await settle();
            return store.kitchenCatalogue.publishMeal(mealId, request);
        },
        async retireMeal(mealId, request): Promise<MealAdmin> {
            await settle();
            return store.kitchenCatalogue.retireMeal(mealId, request);
        },
        async setMealAvailability(mealId, request): Promise<MealAdmin> {
            await settle();
            return store.kitchenCatalogue.setMealAvailability(mealId, request);
        },

        async listPlans(filter?: PlanAdminFilter): Promise<CursorPage<PlanAdmin>> {
            await settle();
            const matched = store.kitchenCatalogue.listPlans().filter((row) => {
                if (!matchesText([row.name.en, row.name.ar, row.summary.en], filter?.query)) {
                    return false;
                }
                if (!hasStatus(row.meta.status, filter?.statuses)) return false;
                if (filter?.kitchenId !== undefined && row.kitchenId !== filter.kitchenId) {
                    return false;
                }
                return true;
            });
            return paginate(matched, filter);
        },
        async getPlan(planId): Promise<PlanAdmin> {
            await settle();
            return store.kitchenCatalogue.getPlan(planId);
        },
        async createPlan(request): Promise<PlanAdmin> {
            await settle();
            return store.kitchenCatalogue.createPlan(request);
        },
        async updatePlan(planId, request): Promise<PlanAdmin> {
            await settle();
            return store.kitchenCatalogue.updatePlan(planId, request);
        },
        async publishPlan(planId, request): Promise<PlanAdmin> {
            await settle();
            return store.kitchenCatalogue.publishPlan(planId, request);
        },
        async retirePlan(planId, request): Promise<PlanAdmin> {
            await settle();
            return store.kitchenCatalogue.retirePlan(planId, request);
        },
        async setPlanVariants(planId, request): Promise<PlanAdmin> {
            await settle();
            return store.kitchenCatalogue.setPlanVariants(planId, request);
        },
        async setPlanDurations(planId, request): Promise<PlanAdmin> {
            await settle();
            return store.kitchenCatalogue.setPlanDurations(planId, request);
        },
        async setPlanCombinations(planId, request): Promise<PlanAdmin> {
            await settle();
            return store.kitchenCatalogue.setPlanCombinations(planId, request);
        },

        async listZones(filter?: DeliveryZoneAdminFilter): Promise<CursorPage<DeliveryZoneAdmin>> {
            await settle();
            const matched = store.kitchenCatalogue.listZones().filter((row) => {
                if (!matchesText([row.name.en, row.name.ar], filter?.query)) return false;
                if (!hasStatus(row.meta.status, filter?.statuses)) return false;
                if (
                    filter?.branchId !== undefined &&
                    !row.branchIds.some((branchId) => branchId === filter.branchId)
                ) {
                    return false;
                }
                return true;
            });
            return paginate(matched, filter);
        },
        async getZone(zoneId): Promise<DeliveryZoneAdmin> {
            await settle();
            return store.kitchenCatalogue.getZone(zoneId);
        },
        async createZone(request): Promise<DeliveryZoneAdmin> {
            await settle();
            return store.kitchenCatalogue.createZone(request);
        },
        async updateZone(zoneId, request): Promise<DeliveryZoneAdmin> {
            await settle();
            return store.kitchenCatalogue.updateZone(zoneId, request);
        },
        async archiveZone(zoneId, request): Promise<DeliveryZoneAdmin> {
            await settle();
            return store.kitchenCatalogue.archiveZone(zoneId, request);
        },
        async setZoneAreas(zoneId, request): Promise<DeliveryZoneAdmin> {
            await settle();
            return store.kitchenCatalogue.setZoneAreas(zoneId, request);
        },
        async setDeliveryWindows(zoneId, request): Promise<DeliveryZoneAdmin> {
            await settle();
            return store.kitchenCatalogue.setDeliveryWindows(zoneId, request);
        },

        async getBranchOperating(branchId): Promise<BranchOperating> {
            await settle();
            return store.kitchenCatalogue.getBranchOperating(branchId);
        },
        async setBranchOperating(branchId, request): Promise<BranchOperating> {
            await settle();
            return store.kitchenCatalogue.setBranchOperating(branchId, request);
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
        kitchenAdmin,
    };
}

/** Status filters are "any of these", and an absent filter means "every status". */
function hasStatus(
    status: PublishableStatus,
    wanted: readonly PublishableStatus[] | undefined,
): boolean {
    return wanted === undefined || wanted.length === 0 || wanted.includes(status);
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
