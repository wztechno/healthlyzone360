import type {
    CartId,
    CorporateProgrammeId,
    DietitianId,
    KitchenId,
    MealId,
    MealPlanEntryId,
    MealPlanId,
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
    CommerceRepository,
    CreateSubscriptionRequest,
    PauseSubscriptionRequest,
    PreviewCheckoutRequest,
    SkipDayRequest,
    Subscription,
    SubscriptionConfiguration,
    SubscriptionFilter,
    SubscriptionPreview,
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
    DietCategory,
    Dietitian,
    DietitianFilter,
    Kitchen,
    KitchenFilter,
    MarketplaceMeal,
    MarketplaceRepository,
    MealFilter,
    PlanFilter,
    SubscriptionPlan,
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
 * The API side of the eight Prompt 2 contracts — **written out, method by method, and rejecting**.
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
function notImplemented(endpoint: string): Promise<never> {
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
    listKitchens: `GET ${BASE}/marketplace/kitchens`,
    getKitchen: `GET ${BASE}/marketplace/kitchens/{kitchen}`,
    listMeals: `GET ${BASE}/marketplace/meals`,
    getMeal: `GET ${BASE}/marketplace/meals/{meal}`,
    listPlans: `GET ${BASE}/marketplace/meal-plans`,
    getPlan: `GET ${BASE}/marketplace/meal-plans/{plan}`,
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

    getCart: `POST ${BASE}/carts`,
    addCartItem: `POST ${BASE}/carts/{cart}/items`,
    removeCartItem: `DELETE ${BASE}/carts/{cart}/items/{item}`,
    previewCheckout: `POST ${BASE}/checkouts/preview`,
    previewSubscription: `POST ${BASE}/subscriptions/preview`,
    createSubscription: `POST ${BASE}/subscriptions`,
    getSubscription: `GET ${BASE}/subscriptions/{subscription}`,
    listSubscriptions: `GET ${BASE}/subscriptions`,
    pause: `POST ${BASE}/subscriptions/{subscription}/pause`,
    resume: `POST ${BASE}/subscriptions/{subscription}/resume`,
    skipDay: `POST ${BASE}/subscriptions/{subscription}/skip`,
    changeAddress: `POST ${BASE}/subscriptions/{subscription}/address`,
    changeSlot: `POST ${BASE}/subscriptions/{subscription}/slot`,

    getCorporateProgramme: `GET ${BASE}/business/programmes/{programme}`,
    listCatalogue: `GET ${BASE}/business/programmes/{programme}/catalogue`,
    getCatalogueItem: `GET ${BASE}/business/catalogue/{item}`,
    requestQuotation: `POST ${BASE}/business/quotations`,
    listQuotations: `GET ${BASE}/business/quotations`,

    listReviewQueue: `GET ${BASE}/professional/reviews`,
    getReview: `GET ${BASE}/professional/reviews/{review}`,
    approve: `POST ${BASE}/professional/reviews/{review}/approve`,
    requestChanges: `POST ${BASE}/professional/reviews/{review}/request-changes`,
    getClientPlan: `GET ${BASE}/professional/clients/{client}/meal-plans/{plan}`,
    setDietitianNote: `PUT ${BASE}/professional/meal-plans/{plan}/note`,
    setOverride: `PUT ${BASE}/professional/clients/{client}/nutrition-target`,
} as const;

/* ------------------------------------------------------------------------------------------------
 * Marketplace
 * ---------------------------------------------------------------------------------------------- */

export const apiMarketplaceRepository: MarketplaceRepository = {
    listKitchens(_filter?: KitchenFilter): Promise<CursorPage<Kitchen>> {
        return notImplemented(PROTOTYPE_ENDPOINTS.listKitchens);
    },
    getKitchen(_kitchenId: KitchenId): Promise<Kitchen> {
        return notImplemented(PROTOTYPE_ENDPOINTS.getKitchen);
    },
    listMeals(_filter?: MealFilter): Promise<CursorPage<MarketplaceMeal>> {
        return notImplemented(PROTOTYPE_ENDPOINTS.listMeals);
    },
    getMeal(_mealId: MealId): Promise<MarketplaceMeal> {
        return notImplemented(PROTOTYPE_ENDPOINTS.getMeal);
    },
    listPlans(_filter?: PlanFilter): Promise<CursorPage<SubscriptionPlan>> {
        return notImplemented(PROTOTYPE_ENDPOINTS.listPlans);
    },
    getPlan(_planId: SubscriptionPlanId): Promise<SubscriptionPlan> {
        return notImplemented(PROTOTYPE_ENDPOINTS.getPlan);
    },
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
    getCart(): Promise<Cart> {
        return notImplemented(PROTOTYPE_ENDPOINTS.getCart);
    },
    addCartItem(_cartId: CartId, _request: AddCartItemRequest): Promise<Cart> {
        return notImplemented(PROTOTYPE_ENDPOINTS.addCartItem);
    },
    removeCartItem(_cartId: CartId, _itemId: string): Promise<Cart> {
        return notImplemented(PROTOTYPE_ENDPOINTS.removeCartItem);
    },
    previewCheckout(_request: PreviewCheckoutRequest): Promise<CheckoutPreview> {
        return notImplemented(PROTOTYPE_ENDPOINTS.previewCheckout);
    },
    previewSubscription(_configuration: SubscriptionConfiguration): Promise<SubscriptionPreview> {
        return notImplemented(PROTOTYPE_ENDPOINTS.previewSubscription);
    },
    createSubscription(_request: CreateSubscriptionRequest): Promise<Subscription> {
        return notImplemented(PROTOTYPE_ENDPOINTS.createSubscription);
    },
    getSubscription(_subscriptionId: SubscriptionId): Promise<Subscription> {
        return notImplemented(PROTOTYPE_ENDPOINTS.getSubscription);
    },
    listSubscriptions(_filter?: SubscriptionFilter): Promise<CursorPage<Subscription>> {
        return notImplemented(PROTOTYPE_ENDPOINTS.listSubscriptions);
    },
    pause(
        _subscriptionId: SubscriptionId,
        _request?: PauseSubscriptionRequest,
    ): Promise<Subscription> {
        return notImplemented(PROTOTYPE_ENDPOINTS.pause);
    },
    resume(_subscriptionId: SubscriptionId): Promise<Subscription> {
        return notImplemented(PROTOTYPE_ENDPOINTS.resume);
    },
    skipDay(_subscriptionId: SubscriptionId, _request: SkipDayRequest): Promise<Subscription> {
        return notImplemented(PROTOTYPE_ENDPOINTS.skipDay);
    },
    changeAddress(
        _subscriptionId: SubscriptionId,
        _request: ChangeAddressRequest,
    ): Promise<Subscription> {
        return notImplemented(PROTOTYPE_ENDPOINTS.changeAddress);
    },
    changeSlot(
        _subscriptionId: SubscriptionId,
        _request: ChangeSlotRequest,
    ): Promise<Subscription> {
        return notImplemented(PROTOTYPE_ENDPOINTS.changeSlot);
    },
};

/* ------------------------------------------------------------------------------------------------
 * Business
 * ---------------------------------------------------------------------------------------------- */

export const apiBusinessRepository: BusinessRepository = {
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

/** The eight, as one bundle, for `createApiRepositories` to spread. */
export const API_PROTOTYPE_REPOSITORIES = {
    marketplace: apiMarketplaceRepository,
    nutrition: apiNutritionRepository,
    planner: apiMealPlanRepository,
    foods: apiFoodRepository,
    virtualDietitian: apiVirtualDietitianRepository,
    commerce: apiCommerceRepository,
    business: apiBusinessRepository,
    professional: apiProfessionalRepository,
} as const;
