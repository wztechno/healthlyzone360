import type {
    CartId,
    CorporateProgrammeId,
    DeliveryZoneId,
    DietitianId,
    IngredientId,
    KitchenBranchId,
    MealId,
    MealPlanEntryId,
    MealPlanId,
    PriceListId,
    ProductId,
    RecipeId,
    SubscriptionId,
    SubscriptionPlanId,
    UserId,
    VdSessionId,
} from '@healthy360/domain-types';
import type { NutritionTargetRequest, NutritionTargetResult } from '@healthy360/nutrition';

import type {
    BusinessRepository,
    CatalogueFilter,
    CatalogueItem,
    CorporateProgramme,
    Quotation,
    QuotationFilter,
    RequestQuotationRequest,
} from '../contracts/business.ts';
import type {
    AddCartItemRequest,
    Cart,
    ChangeAddressRequest,
    ChangeSlotRequest,
    CheckoutPreview,
    CancelSubscriptionRequest,
    CommerceRepository,
    CreateSubscriptionRequest,
    PauseSubscriptionRequest,
    PlaceOrderRequest,
    PlacedOrder,
    PreviewCheckoutRequest,
    SetSubscriptionMealChoicesRequest,
    SetSubscriptionWeekdaysRequest,
    SkipDayRequest,
    Subscription,
    SubscriptionBalance,
    SubscriptionCancellation,
    SubscriptionConfiguration,
    SubscriptionFilter,
    SubscriptionDelivery,
    SubscriptionDeliveryFilter,
    SubscriptionMealChoice,
    SubscriptionPreview,
    SubscriptionQuote,
    SubscriptionQuoteRequest,
} from '../contracts/commerce.ts';
import { ApiError, apiFailure } from '../contracts/failure.ts';
import type {
    Food,
    FoodRepository,
    FoodSearchFilter,
    GroceryList,
    Pantry,
    Recipe,
    RecipeFilter,
} from '../contracts/foods.ts';
import type {
    AllergenClass,
    BranchOperating,
    CreateDeliveryZoneRequest,
    CreateIngredientRequest,
    CreateMealRequest,
    CreatePlanRequest,
    CreateProductRequest,
    CreateRecipeRequest,
    DeliveryZoneAdmin,
    DeliveryZoneAdminFilter,
    IngredientAdmin,
    IngredientAdminFilter,
    KitchenAdminRepository,
    LockedRequest,
    MealAdmin,
    MealAdminFilter,
    PlanAdmin,
    PlanAdminFilter,
    PriceListAdmin,
    PriceListAdminFilter,
    ProductAdmin,
    ProductAdminFilter,
    RecipeAdmin,
    RecipeAdminFilter,
    RecipeAdminSummary,
    RecipeRollupDraft,
    RecipeRollupPreview,
    ServiceArea,
    ServiceAreaFilter,
    SetBranchOperatingRequest,
    SetChannelAvailabilityRequest,
    SetDeliveryWindowsRequest,
    SetIngredientAllergensRequest,
    SetMealAvailabilityRequest,
    SetPlanCombinationsRequest,
    SetPlanDurationsRequest,
    SetPlanVariantsRequest,
    SetPriceListEntriesRequest,
    SetRecipeLinesRequest,
    SetRecipeOutputsRequest,
    SetRecipeStepsRequest,
    SetZoneAreasRequest,
    UpdateDeliveryZoneRequest,
    UpdateIngredientRequest,
    UpdateMealRequest,
    UpdatePlanRequest,
    UpdateProductRequest,
    UpdateRecipeRequest,
} from '../contracts/kitchen-admin.ts';
import type {
    DietCategory,
    Dietitian,
    DietitianFilter,
    MarketplaceRepository,
} from '../contracts/marketplace.ts';
import type {
    NutritionRepository,
    NutritionReview,
    RequestNutritionReviewRequest,
    StoredNutritionTarget,
    UpdateNutritionTargetRequest,
} from '../contracts/nutrition.ts';
import type { CursorPage, CursorPageRequest } from '../contracts/pagination.ts';
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
} from '../contracts/planner.ts';
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
} from '../contracts/professional.ts';
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
} from '../contracts/virtual-dietitian.ts';

/**
 * The API side of the nine proposed contracts — **written out, method by method, and rejecting**.
 *
 * None of these endpoints exists. They are proposed drafts in `docs/api/proposed/` and nothing
 * serves them, so there is no honest implementation to write. What there *is* is a choice about how
 * the absence is represented, and the three obvious options are all worse than this one:
 *
 * - **Leave the fields off the API bundle.** Then `Repositories` cannot require them, every call
 *   site becomes `repositories.planner?.getWeek(...)`, and the compiler stops being able to prove
 *   that the two implementations cover the same surface — which is the entire reason the contracts
 *   exist.
 * - **Generate the stubs with a `Proxy`.** Cheaper to write, and it would silently keep "working"
 *   after a method is added to a contract. The compiler would never notice the omission; a screen
 *   would find it at runtime, in production.
 * - **Throw a plain `Error`.** A screen's error boundary would show "something went wrong on our
 *   side", which is false. `prototype.not_implemented` lets it say what is actually true.
 *
 * So every method is spelled out, and every one rejects with `prototype.not_implemented` carrying
 * the endpoint it *would* have called. Adding a method to a contract breaks this file at compile
 * time, which is exactly when it should break. `prototype-repositories.test.ts` walks every method
 * on every repository and asserts the code, so a stub that silently resolved would also fail.
 *
 * This file imports **nothing** from `../mock/`. The fixture world must stay out of the api-mode
 * chunk; `import-graph.test.ts` asserts that it does.
 */

/** Endpoint strings are the proposed paths from `docs/api/proposed/`, prefixed as they are served. */
const BASE = '/api/v1';

/**
 * The single rejection.
 *
 * A **rejected promise**, not a synchronous throw. Every method here is declared as returning a
 * `Promise`, and a caller is entitled to write `repository.getWeek(...).catch(...)` without a
 * `try` around it. A stub that threw synchronously would behave differently from every other
 * repository in the package, which is precisely the difference this layer exists to erase.
 *
 * The message names the endpoint it *would* have called, so the development-only contract line the
 * app renders beside `prototype.not_implemented` has something true to show.
 */
export function notImplemented(endpoint: string): Promise<never> {
    return Promise.reject(
        new ApiError(
            apiFailure('prototype.not_implemented', {
                message:
                    'This part of the prototype has no backend yet. ' +
                    `The proposed endpoint is ${endpoint}.`,
            }),
        ),
    );
}

/** Every endpoint a stub names, so the test can assert the set rather than trust each string. */
export const PROTOTYPE_ENDPOINTS = {
    /**
     * **Marketplace kitchens and meals are gone from this table (M1)** — deliberately, and the
     * absence is the record. `listKitchens`, `getKitchen`, `listMeals` and `getMeal` are served by
     * real endpoints and implemented in `./marketplace-repository.ts`; this table is the ledger of
     * what is *still* a prototype, so an entry that outlived its stub would make the ledger a lie.
     *
     * The three that remain are not oversights: dietitians and diet categories have no backend
     * at all.
     *
     * The plans rows are gone (DEC1): seven real workbook plans are priced and published, so
     * `createApiPlanReads(transport)` is spread into the marketplace repository — the exact
     * condition the earlier note demanded.
     */
    listDietitians: `GET ${BASE}/marketplace/dietitians`,
    getDietitian: `GET ${BASE}/marketplace/dietitians/{dietitian}`,
    listDietCategories: `GET ${BASE}/marketplace/diet-categories`,

    calculateTargets: `POST ${BASE}/nutrition/calculate-targets`,
    getCurrentTargets: `GET ${BASE}/nutrition/targets/current`,
    updateCurrentTargets: `PUT ${BASE}/nutrition/targets/current`,
    requestNutritionReview: `POST ${BASE}/nutrition/targets/current/review`,

    listMealPlans: `GET ${BASE}/meal-plans`,
    getCurrentMealPlan: `GET ${BASE}/meal-plans/current`,
    getWeek: `GET ${BASE}/meal-plans/{plan}`,
    getDay: `GET ${BASE}/meal-plans/{plan}/days/{day}`,
    generate: `POST ${BASE}/meal-plans/generate`,
    regenerateWeek: `POST ${BASE}/meal-plans/{plan}/regenerate`,
    regenerateDay: `POST ${BASE}/meal-plans/{plan}/days/{day}/regenerate`,
    regenerateEntry: `POST ${BASE}/meal-plans/{plan}/entries/{entry}/regenerate`,
    lockEntry: `POST ${BASE}/meal-plans/{plan}/entries/{entry}/lock`,
    unlockEntry: `DELETE ${BASE}/meal-plans/{plan}/entries/{entry}/lock`,
    replaceEntry: `POST ${BASE}/meal-plans/{plan}/entries/{entry}/replace`,
    adjustPortion: `PATCH ${BASE}/meal-plans/{plan}/entries/{entry}/portion`,
    addEntry: `POST ${BASE}/meal-plans/{plan}/entries`,
    removeEntry: `DELETE ${BASE}/meal-plans/{plan}/entries/{entry}`,
    repeatMeal: `POST ${BASE}/meal-plans/{plan}/entries/repeat`,
    getNotes: `GET ${BASE}/meal-plans/{plan}/notes`,
    setNotes: `PUT ${BASE}/meal-plans/{plan}/notes`,
    history: `GET ${BASE}/meal-plans/{plan}/history`,
    saveAsTemplate: `POST ${BASE}/meal-plans/{plan}/template`,
    duplicate: `POST ${BASE}/meal-plans/{plan}/duplicate`,

    searchFoods: `GET ${BASE}/foods`,
    listRecipes: `GET ${BASE}/recipes`,
    getRecipe: `GET ${BASE}/recipes/{recipe}`,
    getGroceryList: `GET ${BASE}/grocery-lists/{week}`,
    getPantry: `GET ${BASE}/pantry`,

    createSession: `POST ${BASE}/virtual-dietitian/sessions`,
    getSession: `GET ${BASE}/virtual-dietitian/sessions/{session}`,
    listSessions: `GET ${BASE}/virtual-dietitian/sessions`,
    sendMessage: `POST ${BASE}/virtual-dietitian/sessions/{session}/messages`,
    generateDraft: `POST ${BASE}/virtual-dietitian/sessions/{session}/generate-draft`,
    requestVdReview: `POST ${BASE}/virtual-dietitian/sessions/{session}/request-review`,
    acceptProposal: `POST ${BASE}/virtual-dietitian/sessions/{session}/accept`,
    overrideProposal: `POST ${BASE}/virtual-dietitian/sessions/{session}/override`,

    listCorporateProgrammes: `GET ${BASE}/b2b/programmes`,
    getCorporateProgramme: `GET ${BASE}/b2b/programmes/{programme}`,
    listCatalogue: `GET ${BASE}/b2b/catalogue/items`,
    getCatalogueItem: `GET ${BASE}/b2b/catalogue/items/{item}`,
    requestQuotation: `POST ${BASE}/b2b/programmes/{programme}/quotations`,
    listQuotations: `GET ${BASE}/b2b/programmes/{programme}/quotations`,

    listReviewQueue: `GET ${BASE}/professional/reviews`,
    getReview: `GET ${BASE}/professional/reviews/{review}`,
    approve: `POST ${BASE}/professional/reviews/{review}/approve`,
    requestChanges: `POST ${BASE}/professional/reviews/{review}/request-changes`,
    getClientPlan: `GET ${BASE}/professional/clients/{client}/meal-plans/{plan}`,
    setDietitianNote: `PUT ${BASE}/professional/meal-plans/{plan}/note`,
    setOverride: `PUT ${BASE}/professional/clients/{client}/nutrition-target`,

    // Kitchen-admin endpoints left this ledger when Phase 3 writes landed in
    // `./kitchen-admin-writes.ts` (including rollup preview, meal availability,
    // plan combinations and delivery windows).
} as const;

/* ------------------------------------------------------------------------------------------------
 * Marketplace — the part of it that is still a prototype
 *
 * Four of the nine methods moved to `./marketplace-repository.ts` in M1, where they call real
 * endpoints. What is left is the five that still have nothing behind them, typed as a subset so the
 * compiler stops this object from silently claiming to be a whole `MarketplaceRepository` again.
 * ---------------------------------------------------------------------------------------------- */

/** The still-unimplemented half of {@link MarketplaceRepository}. */
export type PrototypeMarketplaceRepository = Pick<
    MarketplaceRepository,
    'listDietitians' | 'getDietitian' | 'listDietCategories'
>;

export const apiMarketplacePrototypeRepository: PrototypeMarketplaceRepository = {
    listDietitians(_filter?: DietitianFilter): Promise<CursorPage<Dietitian>> {
        return notImplemented(PROTOTYPE_ENDPOINTS.listDietitians);
    },
    getDietitian(_dietitianId: DietitianId): Promise<Dietitian> {
        return notImplemented(PROTOTYPE_ENDPOINTS.getDietitian);
    },
    listDietCategories(): Promise<readonly DietCategory[]> {
        return notImplemented(PROTOTYPE_ENDPOINTS.listDietCategories);
    },
};

/* ------------------------------------------------------------------------------------------------
 * Nutrition targets
 * ---------------------------------------------------------------------------------------------- */

export const apiNutritionRepository: NutritionRepository = {
    calculateTargets(_request: NutritionTargetRequest): Promise<NutritionTargetResult> {
        return notImplemented(PROTOTYPE_ENDPOINTS.calculateTargets);
    },
    getCurrentTargets(): Promise<StoredNutritionTarget | null> {
        return notImplemented(PROTOTYPE_ENDPOINTS.getCurrentTargets);
    },
    updateCurrentTargets(_request: UpdateNutritionTargetRequest): Promise<StoredNutritionTarget> {
        return notImplemented(PROTOTYPE_ENDPOINTS.updateCurrentTargets);
    },
    requestReview(_request: RequestNutritionReviewRequest): Promise<NutritionReview> {
        return notImplemented(PROTOTYPE_ENDPOINTS.requestNutritionReview);
    },
};

/* ------------------------------------------------------------------------------------------------
 * Planner
 * ---------------------------------------------------------------------------------------------- */

export const apiMealPlanRepository: MealPlanRepository = {
    listPlans(_request?: CursorPageRequest): Promise<CursorPage<MealPlanSummary>> {
        return notImplemented(PROTOTYPE_ENDPOINTS.listMealPlans);
    },
    getCurrentPlan(): Promise<MealPlanSummary | null> {
        return notImplemented(PROTOTYPE_ENDPOINTS.getCurrentMealPlan);
    },
    getWeek(_planId: MealPlanId, _weekStart: string): Promise<MealPlanWeek> {
        return notImplemented(PROTOTYPE_ENDPOINTS.getWeek);
    },
    getDay(_planId: MealPlanId, _date: string): Promise<MealPlanDay> {
        return notImplemented(PROTOTYPE_ENDPOINTS.getDay);
    },
    generate(_request: GeneratePlanRequest): Promise<MealPlanWeek> {
        return notImplemented(PROTOTYPE_ENDPOINTS.generate);
    },
    regenerateWeek(_planId: MealPlanId, _request?: RegenerateScopeRequest): Promise<MealPlanWeek> {
        return notImplemented(PROTOTYPE_ENDPOINTS.regenerateWeek);
    },
    regenerateDay(
        _planId: MealPlanId,
        _date: string,
        _request?: RegenerateScopeRequest,
    ): Promise<MealPlanDay> {
        return notImplemented(PROTOTYPE_ENDPOINTS.regenerateDay);
    },
    regenerateEntry(
        _planId: MealPlanId,
        _entryId: MealPlanEntryId,
        _request?: RegenerateScopeRequest,
    ): Promise<MealPlanEntry> {
        return notImplemented(PROTOTYPE_ENDPOINTS.regenerateEntry);
    },
    lockEntry(_planId: MealPlanId, _entryId: MealPlanEntryId): Promise<MealPlanEntry> {
        return notImplemented(PROTOTYPE_ENDPOINTS.lockEntry);
    },
    unlockEntry(_planId: MealPlanId, _entryId: MealPlanEntryId): Promise<MealPlanEntry> {
        return notImplemented(PROTOTYPE_ENDPOINTS.unlockEntry);
    },
    replaceEntry(
        _planId: MealPlanId,
        _entryId: MealPlanEntryId,
        _request: ReplaceEntryRequest,
    ): Promise<readonly MealPlanEntry[]> {
        return notImplemented(PROTOTYPE_ENDPOINTS.replaceEntry);
    },
    adjustPortion(
        _planId: MealPlanId,
        _entryId: MealPlanEntryId,
        _request: AdjustPortionRequest,
    ): Promise<MealPlanEntry> {
        return notImplemented(PROTOTYPE_ENDPOINTS.adjustPortion);
    },
    addEntry(_planId: MealPlanId, _request: AddEntryRequest): Promise<MealPlanEntry> {
        return notImplemented(PROTOTYPE_ENDPOINTS.addEntry);
    },
    removeEntry(_planId: MealPlanId, _entryId: MealPlanEntryId): Promise<void> {
        return notImplemented(PROTOTYPE_ENDPOINTS.removeEntry);
    },
    repeatMeal(
        _planId: MealPlanId,
        _request: RepeatMealRequest,
    ): Promise<readonly MealPlanEntry[]> {
        return notImplemented(PROTOTYPE_ENDPOINTS.repeatMeal);
    },
    getNotes(_planId: MealPlanId): Promise<PlanNotes> {
        return notImplemented(PROTOTYPE_ENDPOINTS.getNotes);
    },
    setNotes(_planId: MealPlanId, _request: SetPlanNotesRequest): Promise<PlanNotes> {
        return notImplemented(PROTOTYPE_ENDPOINTS.setNotes);
    },
    history(
        _planId: MealPlanId,
        _request?: CursorPageRequest,
    ): Promise<CursorPage<PlanHistoryEvent>> {
        return notImplemented(PROTOTYPE_ENDPOINTS.history);
    },
    saveAsTemplate(_planId: MealPlanId, _request: SaveTemplateRequest): Promise<MealPlanSummary> {
        return notImplemented(PROTOTYPE_ENDPOINTS.saveAsTemplate);
    },
    duplicate(_planId: MealPlanId, _request: DuplicatePlanRequest): Promise<MealPlanWeek> {
        return notImplemented(PROTOTYPE_ENDPOINTS.duplicate);
    },
};

/* ------------------------------------------------------------------------------------------------
 * Foods and recipes
 * ---------------------------------------------------------------------------------------------- */

export const apiFoodRepository: FoodRepository = {
    searchFoods(_filter: FoodSearchFilter): Promise<CursorPage<Food>> {
        return notImplemented(PROTOTYPE_ENDPOINTS.searchFoods);
    },
    listRecipes(_filter?: RecipeFilter): Promise<CursorPage<Recipe>> {
        return notImplemented(PROTOTYPE_ENDPOINTS.listRecipes);
    },
    getRecipe(_recipeId: RecipeId): Promise<Recipe> {
        return notImplemented(PROTOTYPE_ENDPOINTS.getRecipe);
    },
    getGroceryList(_weekStart: string): Promise<GroceryList> {
        return notImplemented(PROTOTYPE_ENDPOINTS.getGroceryList);
    },
    getPantry(): Promise<Pantry> {
        return notImplemented(PROTOTYPE_ENDPOINTS.getPantry);
    },
};

/* ------------------------------------------------------------------------------------------------
 * Virtual Dietitian
 * ---------------------------------------------------------------------------------------------- */

export const apiVirtualDietitianRepository: VirtualDietitianRepository = {
    createSession(_request?: CreateVdSessionRequest): Promise<VdSession> {
        return notImplemented(PROTOTYPE_ENDPOINTS.createSession);
    },
    getSession(_sessionId: VdSessionId): Promise<VdSession> {
        return notImplemented(PROTOTYPE_ENDPOINTS.getSession);
    },
    listSessions(_request?: CursorPageRequest): Promise<CursorPage<VdSessionSummary>> {
        return notImplemented(PROTOTYPE_ENDPOINTS.listSessions);
    },
    sendMessage(_sessionId: VdSessionId, _request: SendVdMessageRequest): Promise<VdSession> {
        return notImplemented(PROTOTYPE_ENDPOINTS.sendMessage);
    },
    generateDraft(_sessionId: VdSessionId, _request: GenerateVdDraftRequest): Promise<VdSession> {
        return notImplemented(PROTOTYPE_ENDPOINTS.generateDraft);
    },
    requestReview(_sessionId: VdSessionId, _request?: RequestVdReviewRequest): Promise<VdSession> {
        return notImplemented(PROTOTYPE_ENDPOINTS.requestVdReview);
    },
    acceptProposal(_sessionId: VdSessionId, _request: AcceptVdProposalRequest): Promise<VdSession> {
        return notImplemented(PROTOTYPE_ENDPOINTS.acceptProposal);
    },
    overrideProposal(
        _sessionId: VdSessionId,
        _request: OverrideVdProposalRequest,
    ): Promise<VdSession> {
        return notImplemented(PROTOTYPE_ENDPOINTS.overrideProposal);
    },
};

/* ------------------------------------------------------------------------------------------------
 * Commerce
 * ---------------------------------------------------------------------------------------------- */

export const apiCommerceRepository: CommerceRepository = {
    /**
     * Cart CRUD and the interim checkout preview are served — implemented in
     * `./cart-repository.ts` and spread over this object by `createApiRepositories`, so they have
     * no rows in `PROTOTYPE_ENDPOINTS`.
     */
    getCart(_options?: { readonly channelCode?: string | undefined }): Promise<Cart> {
        return notImplemented(`POST ${BASE}/carts`);
    },
    addCartItem(_cartId: CartId, _request: AddCartItemRequest): Promise<Cart> {
        return notImplemented(`POST ${BASE}/carts/{cart}/items`);
    },
    removeCartItem(_cartId: CartId, _itemId: string): Promise<Cart> {
        return notImplemented(`DELETE ${BASE}/carts/{cart}/items/{item}`);
    },
    previewCheckout(_request: PreviewCheckoutRequest): Promise<CheckoutPreview> {
        return notImplemented(`POST ${BASE}/checkouts/preview`);
    },
    /**
     * Declared as a rejection so this object stays a complete `CommerceRepository`, and overridden
     * per bundle by `createApiRepositories` with the real implementation from
     * `./order-repository.ts` — it holds the transport, which a shared stateless object cannot.
     * `POST /orders` is served, so it has no row in `PROTOTYPE_ENDPOINTS`.
     */
    placeOrder(_request: PlaceOrderRequest): Promise<PlacedOrder> {
        return notImplemented(`POST ${BASE}/orders`);
    },
    /**
     * Subscription lifecycle (quote preview, create, reads, pause/resume/skip, address/window) is
     * served — implemented in `./subscription-repository.ts` and spread over this object by
     * `createApiRepositories`, so none of these have rows in `PROTOTYPE_ENDPOINTS`.
     */
    previewSubscription(_configuration: SubscriptionConfiguration): Promise<SubscriptionPreview> {
        return notImplemented(`GET ${BASE}/subscriptions/quote`);
    },
    createSubscription(_request: CreateSubscriptionRequest): Promise<Subscription> {
        return notImplemented(`POST ${BASE}/subscriptions`);
    },
    getSubscription(_subscriptionId: SubscriptionId): Promise<Subscription> {
        return notImplemented(`GET ${BASE}/me/subscriptions/{subscription}`);
    },
    listSubscriptions(_filter?: SubscriptionFilter): Promise<CursorPage<Subscription>> {
        return notImplemented(`GET ${BASE}/me/subscriptions`);
    },
    pause(
        _subscriptionId: SubscriptionId,
        _request?: PauseSubscriptionRequest,
    ): Promise<Subscription> {
        return notImplemented(`POST ${BASE}/me/subscriptions/{subscription}/pause`);
    },
    resume(_subscriptionId: SubscriptionId): Promise<Subscription> {
        return notImplemented(`POST ${BASE}/me/subscriptions/{subscription}/resume`);
    },
    skipDay(_subscriptionId: SubscriptionId, _request: SkipDayRequest): Promise<Subscription> {
        return notImplemented(`POST ${BASE}/me/subscriptions/{subscription}/skips`);
    },
    changeAddress(
        _subscriptionId: SubscriptionId,
        _request: ChangeAddressRequest,
    ): Promise<Subscription> {
        return notImplemented(`PUT ${BASE}/me/subscriptions/{subscription}/address`);
    },
    changeSlot(
        _subscriptionId: SubscriptionId,
        _request: ChangeSlotRequest,
    ): Promise<Subscription> {
        return notImplemented(`PUT ${BASE}/me/subscriptions/{subscription}/window`);
    },

    /*
     * S1 — **all six are served.**
     *
     * Declared here as rejections so this object stays a complete `CommerceRepository` — the
     * compiler has to be able to prove that, and it is the whole reason every method is spelled
     * out — and `createApiRepositories` overrides all six with the real implementations from
     * `./subscription-repository.ts`, which is why none of them has a row in
     * `PROTOTYPE_ENDPOINTS`.
     *
     * Four of the six were rejecting as recently as the previous wave, and not because the routes
     * were missing: the wire could not answer them without the client inventing a `sales_channel_id`
     * no consumer can obtain, a duration and a plan name the customer projection did not carry, or a
     * meal name the choice payload omitted. Each gap was closed at its root — in the presenter, the
     * request and the spec — rather than papered over with a default here. That history is worth the
     * paragraph: the difference between "no endpoint" and "an endpoint that cannot be called from
     * the surface it was built for" is the difference between a missing feature and a silent one.
     */
    getSubscriptionQuote(_request: SubscriptionQuoteRequest): Promise<SubscriptionQuote> {
        return notImplemented(`GET ${BASE}/subscriptions/quote`);
    },
    getSubscriptionBalance(_subscriptionId: SubscriptionId): Promise<SubscriptionBalance> {
        return notImplemented(`GET ${BASE}/me/subscriptions/{subscription}`);
    },
    listSubscriptionDeliveries(
        _subscriptionId: SubscriptionId,
        _filter?: SubscriptionDeliveryFilter,
    ): Promise<CursorPage<SubscriptionDelivery>> {
        return notImplemented(`GET ${BASE}/me/subscriptions/{subscription}/deliveries`);
    },
    cancelSubscription(
        _subscriptionId: SubscriptionId,
        _request?: CancelSubscriptionRequest,
    ): Promise<SubscriptionCancellation> {
        return notImplemented(`POST ${BASE}/me/subscriptions/{subscription}/cancel`);
    },
    setSubscriptionWeekdays(
        _subscriptionId: SubscriptionId,
        _request: SetSubscriptionWeekdaysRequest,
    ): Promise<Subscription> {
        return notImplemented(`PUT ${BASE}/me/subscriptions/{subscription}/weekdays`);
    },
    setSubscriptionMealChoices(
        _subscriptionId: SubscriptionId,
        _request: SetSubscriptionMealChoicesRequest,
    ): Promise<readonly SubscriptionMealChoice[]> {
        return notImplemented(`PUT ${BASE}/me/subscriptions/{subscription}/choices`);
    },
};

/* ------------------------------------------------------------------------------------------------
 * Business
 * ---------------------------------------------------------------------------------------------- */

export const apiBusinessRepository: BusinessRepository = {
    listCorporateProgrammes(): Promise<readonly CorporateProgramme[]> {
        return notImplemented(PROTOTYPE_ENDPOINTS.listCorporateProgrammes);
    },
    getCorporateProgramme(_programmeId: CorporateProgrammeId): Promise<CorporateProgramme> {
        return notImplemented(PROTOTYPE_ENDPOINTS.getCorporateProgramme);
    },
    listCatalogue(_filter: CatalogueFilter): Promise<CursorPage<CatalogueItem>> {
        return notImplemented(PROTOTYPE_ENDPOINTS.listCatalogue);
    },
    getCatalogueItem(_itemId: string): Promise<CatalogueItem> {
        return notImplemented(PROTOTYPE_ENDPOINTS.getCatalogueItem);
    },
    requestQuotation(_request: RequestQuotationRequest): Promise<Quotation> {
        return notImplemented(PROTOTYPE_ENDPOINTS.requestQuotation);
    },
    listQuotations(_filter?: QuotationFilter): Promise<CursorPage<Quotation>> {
        return notImplemented(PROTOTYPE_ENDPOINTS.listQuotations);
    },
};

/* ------------------------------------------------------------------------------------------------
 * Professional
 * ---------------------------------------------------------------------------------------------- */

export const apiProfessionalRepository: ProfessionalRepository = {
    listReviewQueue(_filter?: ReviewQueueFilter): Promise<CursorPage<ReviewQueueItem>> {
        return notImplemented(PROTOTYPE_ENDPOINTS.listReviewQueue);
    },
    getReview(_reviewId: string): Promise<ReviewDetail> {
        return notImplemented(PROTOTYPE_ENDPOINTS.getReview);
    },
    approve(_reviewId: string, _request: ApproveReviewRequest): Promise<ReviewQueueItem> {
        return notImplemented(PROTOTYPE_ENDPOINTS.approve);
    },
    requestChanges(_reviewId: string, _request: RequestChangesRequest): Promise<ReviewQueueItem> {
        return notImplemented(PROTOTYPE_ENDPOINTS.requestChanges);
    },
    getClientPlan(
        _clientId: UserId,
        _planId: MealPlanId,
        _weekStart: string,
    ): Promise<MealPlanWeek> {
        return notImplemented(PROTOTYPE_ENDPOINTS.getClientPlan);
    },
    setDietitianNote(_request: SetDietitianNoteRequest): Promise<DietitianNote> {
        return notImplemented(PROTOTYPE_ENDPOINTS.setDietitianNote);
    },
    setOverride(_request: SetOverrideRequest): Promise<StoredNutritionTarget> {
        return notImplemented(PROTOTYPE_ENDPOINTS.setOverride);
    },
};

/* ------------------------------------------------------------------------------------------------
 * Kitchen management (K1)
 *
 * Written out like every other stub above rather than generated. The full method list is a lot of
 * repetition, and it is repetition that *earns its keep*: adding a method to `KitchenAdminRepository`
 * has to break this file at compile time, because the alternative — a `Proxy` — would keep
 * "working" and let a screen discover the omission at runtime, in an admin surface where the
 * omission is somebody's unsaved recipe.
 * ---------------------------------------------------------------------------------------------- */

/**
 * The kitchen workspace — mostly a stub, with real implementations spread in by the bundle.
 *
 * `listAllergenClasses` and `listServiceAreas` are overridden from `./reference-repository.ts`;
 * catalogue reads from `./kitchen-admin-repository.ts`; Phase 3 writes from
 * `./kitchen-admin-writes.ts`. Every kitchen-admin contract method is overridden at the bundle;
 * this object remains the rejecting base for the spread.
 */
export const apiKitchenAdminRepository: KitchenAdminRepository = {
    listAllergenClasses(): Promise<readonly AllergenClass[]> {
        return notImplemented(`GET ${BASE}/reference/allergen-classes`);
    },
    listServiceAreas(_filter?: ServiceAreaFilter): Promise<CursorPage<ServiceArea>> {
        return notImplemented(`GET ${BASE}/reference/delivery-areas`);
    },

    listIngredients(_filter?: IngredientAdminFilter): Promise<CursorPage<IngredientAdmin>> {
        return notImplemented(`GET ${BASE}/catalogue/ingredients`);
    },
    getIngredient(_ingredientId: IngredientId): Promise<IngredientAdmin> {
        return notImplemented(`GET ${BASE}/catalogue/ingredients/{ingredient}`);
    },
    createIngredient(_request: CreateIngredientRequest): Promise<IngredientAdmin> {
        return notImplemented(`POST ${BASE}/catalogue/ingredients`);
    },
    updateIngredient(
        _ingredientId: IngredientId,
        _request: UpdateIngredientRequest,
    ): Promise<IngredientAdmin> {
        return notImplemented(`PATCH ${BASE}/catalogue/ingredients/{ingredient}`);
    },
    archiveIngredient(
        _ingredientId: IngredientId,
        _request: LockedRequest,
    ): Promise<IngredientAdmin> {
        return notImplemented(`POST ${BASE}/catalogue/ingredients/{ingredient}/archive`);
    },
    setIngredientAllergens(
        _ingredientId: IngredientId,
        _request: SetIngredientAllergensRequest,
    ): Promise<IngredientAdmin> {
        return notImplemented(`PUT ${BASE}/catalogue/ingredients/{ingredient}/allergens`);
    },

    listRecipes(_filter?: RecipeAdminFilter): Promise<CursorPage<RecipeAdminSummary>> {
        return notImplemented(`GET ${BASE}/catalogue/recipes`);
    },
    getRecipe(_recipeId: RecipeId): Promise<RecipeAdmin> {
        return notImplemented(`GET ${BASE}/catalogue/recipes/{recipe}`);
    },
    createRecipe(_request: CreateRecipeRequest): Promise<RecipeAdmin> {
        return notImplemented(`POST ${BASE}/catalogue/recipes`);
    },
    updateRecipe(_recipeId: RecipeId, _request: UpdateRecipeRequest): Promise<RecipeAdmin> {
        return notImplemented(`PATCH ${BASE}/catalogue/recipes/{recipe}`);
    },
    setRecipeLines(_recipeId: RecipeId, _request: SetRecipeLinesRequest): Promise<RecipeAdmin> {
        return notImplemented(`PUT ${BASE}/catalogue/recipes/{recipe}/versions/{version}/lines`);
    },
    setRecipeSteps(_recipeId: RecipeId, _request: SetRecipeStepsRequest): Promise<RecipeAdmin> {
        return notImplemented(`PUT ${BASE}/catalogue/recipes/{recipe}/versions/{version}/steps`);
    },
    setRecipeOutputs(_recipeId: RecipeId, _request: SetRecipeOutputsRequest): Promise<RecipeAdmin> {
        return notImplemented(`PUT ${BASE}/catalogue/recipes/{recipe}/versions/{version}/outputs`);
    },
    previewRecipeRollup(_draft: RecipeRollupDraft): Promise<RecipeRollupPreview> {
        return notImplemented(`POST ${BASE}/catalogue/recipes/roll-up-preview`);
    },
    publishRecipe(_recipeId: RecipeId, _request: LockedRequest): Promise<RecipeAdmin> {
        return notImplemented(`POST ${BASE}/catalogue/recipes/{recipe}/versions/{version}/publish`);
    },
    retireRecipe(_recipeId: RecipeId, _request: LockedRequest): Promise<RecipeAdmin> {
        return notImplemented(`POST ${BASE}/catalogue/recipes/{recipe}/archive`);
    },

    listProducts(_filter?: ProductAdminFilter): Promise<CursorPage<ProductAdmin>> {
        return notImplemented(`GET ${BASE}/catalogue/items?item_type=product`);
    },
    getProduct(_productId: ProductId): Promise<ProductAdmin> {
        return notImplemented(`GET ${BASE}/catalogue/items/{item}`);
    },
    createProduct(_request: CreateProductRequest): Promise<ProductAdmin> {
        return notImplemented(`POST ${BASE}/catalogue/items`);
    },
    updateProduct(_productId: ProductId, _request: UpdateProductRequest): Promise<ProductAdmin> {
        return notImplemented(`PATCH ${BASE}/catalogue/items/{item}`);
    },
    archiveProduct(_productId: ProductId, _request: LockedRequest): Promise<ProductAdmin> {
        return notImplemented(`POST ${BASE}/catalogue/items/{item}/retire`);
    },
    setProductChannelAvailability(
        _productId: ProductId,
        _request: SetChannelAvailabilityRequest,
    ): Promise<ProductAdmin> {
        return notImplemented(`PUT ${BASE}/catalogue/items/{item}/channels`);
    },

    listPriceLists(_filter?: PriceListAdminFilter): Promise<CursorPage<PriceListAdmin>> {
        return notImplemented(`GET ${BASE}/catalogue/price-lists`);
    },
    getPriceList(_priceListId: PriceListId): Promise<PriceListAdmin> {
        return notImplemented(`GET ${BASE}/catalogue/price-lists/{price_list}`);
    },
    setPriceListEntries(
        _priceListId: PriceListId,
        _request: SetPriceListEntriesRequest,
    ): Promise<PriceListAdmin> {
        return notImplemented(`PUT ${BASE}/catalogue/price-lists/{price_list}/entries`);
    },
    publishPriceList(_priceListId: PriceListId, _request: LockedRequest): Promise<PriceListAdmin> {
        return notImplemented(`POST ${BASE}/catalogue/price-lists/{price_list}/publish`);
    },

    listMeals(_filter?: MealAdminFilter): Promise<CursorPage<MealAdmin>> {
        return notImplemented(`GET ${BASE}/catalogue/items?item_type=meal`);
    },
    getMeal(_mealId: MealId): Promise<MealAdmin> {
        return notImplemented(`GET ${BASE}/catalogue/items/{item}`);
    },
    createMeal(_request: CreateMealRequest): Promise<MealAdmin> {
        return notImplemented(`POST ${BASE}/catalogue/items`);
    },
    updateMeal(_mealId: MealId, _request: UpdateMealRequest): Promise<MealAdmin> {
        return notImplemented(`PATCH ${BASE}/catalogue/items/{item}`);
    },
    publishMeal(_mealId: MealId, _request: LockedRequest): Promise<MealAdmin> {
        return notImplemented(`POST ${BASE}/catalogue/items/{item}/publish`);
    },
    retireMeal(_mealId: MealId, _request: LockedRequest): Promise<MealAdmin> {
        return notImplemented(`POST ${BASE}/catalogue/items/{item}/retire`);
    },
    setMealAvailability(_mealId: MealId, _request: SetMealAvailabilityRequest): Promise<MealAdmin> {
        return notImplemented(`PUT ${BASE}/catalogue/items/{item}/availability`);
    },

    listPlans(_filter?: PlanAdminFilter): Promise<CursorPage<PlanAdmin>> {
        return notImplemented(`GET ${BASE}/catalogue/items?item_type=subscription_plan`);
    },
    getPlan(_planId: SubscriptionPlanId): Promise<PlanAdmin> {
        return notImplemented(`GET ${BASE}/catalogue/plans/{plan}/profile`);
    },
    createPlan(_request: CreatePlanRequest): Promise<PlanAdmin> {
        return notImplemented(`POST ${BASE}/catalogue/items`);
    },
    updatePlan(_planId: SubscriptionPlanId, _request: UpdatePlanRequest): Promise<PlanAdmin> {
        return notImplemented(`PATCH ${BASE}/catalogue/items/{item}`);
    },
    publishPlan(_planId: SubscriptionPlanId, _request: LockedRequest): Promise<PlanAdmin> {
        return notImplemented(`POST ${BASE}/catalogue/items/{item}/publish`);
    },
    retirePlan(_planId: SubscriptionPlanId, _request: LockedRequest): Promise<PlanAdmin> {
        return notImplemented(`POST ${BASE}/catalogue/items/{item}/retire`);
    },
    setPlanVariants(
        _planId: SubscriptionPlanId,
        _request: SetPlanVariantsRequest,
    ): Promise<PlanAdmin> {
        return notImplemented(`PUT ${BASE}/catalogue/plans/{plan}/variants`);
    },
    setPlanDurations(
        _planId: SubscriptionPlanId,
        _request: SetPlanDurationsRequest,
    ): Promise<PlanAdmin> {
        return notImplemented(`PUT ${BASE}/catalogue/plans/{plan}/variant-durations`);
    },
    setPlanCombinations(
        _planId: SubscriptionPlanId,
        _request: SetPlanCombinationsRequest,
    ): Promise<PlanAdmin> {
        return notImplemented(`PUT ${BASE}/catalogue/plan-vocabulary/combinations`);
    },

    listZones(_filter?: DeliveryZoneAdminFilter): Promise<CursorPage<DeliveryZoneAdmin>> {
        return notImplemented(`GET ${BASE}/catalogue/delivery-zones`);
    },
    getZone(_zoneId: DeliveryZoneId): Promise<DeliveryZoneAdmin> {
        return notImplemented(`GET ${BASE}/catalogue/delivery-zones/{zone}`);
    },
    createZone(_request: CreateDeliveryZoneRequest): Promise<DeliveryZoneAdmin> {
        return notImplemented(`POST ${BASE}/catalogue/delivery-zones`);
    },
    updateZone(
        _zoneId: DeliveryZoneId,
        _request: UpdateDeliveryZoneRequest,
    ): Promise<DeliveryZoneAdmin> {
        return notImplemented(`PATCH ${BASE}/catalogue/delivery-zones/{zone}`);
    },
    archiveZone(_zoneId: DeliveryZoneId, _request: LockedRequest): Promise<DeliveryZoneAdmin> {
        return notImplemented(`POST ${BASE}/catalogue/delivery-zones/{zone}/archive`);
    },
    setZoneAreas(
        _zoneId: DeliveryZoneId,
        _request: SetZoneAreasRequest,
    ): Promise<DeliveryZoneAdmin> {
        return notImplemented(`PUT ${BASE}/catalogue/delivery-zones/{zone}/areas`);
    },
    setDeliveryWindows(
        _zoneId: DeliveryZoneId,
        _request: SetDeliveryWindowsRequest,
    ): Promise<DeliveryZoneAdmin> {
        return notImplemented(`PUT ${BASE}/catalogue/delivery-windows`);
    },

    getBranchOperating(_branchId: KitchenBranchId): Promise<BranchOperating> {
        return notImplemented(`GET ${BASE}/kitchen/branch-operating`);
    },
    setBranchOperating(
        _branchId: KitchenBranchId,
        _request: SetBranchOperatingRequest,
    ): Promise<BranchOperating> {
        return notImplemented(`PUT ${BASE}/kitchen/branch-operating`);
    },
};

/**
 * The still-unimplemented repositories, as one bundle for `createApiRepositories` to spread.
 *
 * **Eight, not nine.** `marketplace` left this bundle in M1: half of it is real, so a bundle that
 * still carried it would be describing the surface as unimplemented when it is not.
 * `createApiRepositories` builds the marketplace repository from the transport instead.
 */
export const API_PROTOTYPE_REPOSITORIES = {
    nutrition: apiNutritionRepository,
    planner: apiMealPlanRepository,
    foods: apiFoodRepository,
    virtualDietitian: apiVirtualDietitianRepository,
    commerce: apiCommerceRepository,
    business: apiBusinessRepository,
    professional: apiProfessionalRepository,
    kitchenAdmin: apiKitchenAdminRepository,
} as const;
