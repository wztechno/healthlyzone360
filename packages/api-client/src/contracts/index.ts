import type { AuthRepository } from './auth.ts';
import type { BusinessRepository } from './business.ts';
import type { CommerceRepository } from './commerce.ts';
import type { FoodRepository } from './foods.ts';
import type { MarketplaceRepository } from './marketplace.ts';
import type { NutritionRepository } from './nutrition.ts';
import type { MealPlanRepository } from './planner.ts';
import type { ProfessionalRepository } from './professional.ts';
import type { ContextRepository, DeviceRepository, SessionRepository } from './session.ts';
import type { VirtualDietitianRepository } from './virtual-dietitian.ts';

export {
    API_FAILURE_CODES,
    ApiError,
    apiFailure,
    asApiFailure,
    defaultRetryable,
    isApiFailure,
    isApiFailureCode,
    isAutoRetryable,
    isRateLimitFailure,
    isValidationFailure,
    rateLimitFailure,
    throwFailure,
    validationFailure,
} from './failure.ts';
export type { ApiFailure, ApiFailureCode, FailureOptions, ValidationFields } from './failure.ts';

export type {
    AuthRepository,
    AuthSession,
    EmailVerificationStatus,
    LoginRequest,
    LoginResult,
    PasswordConfirmationResult,
    PasswordResetRequest,
    RegisterRequest,
    RegisterResult,
    ResendVerificationResult,
    TwoFactorChallengeRequest,
    TwoFactorSetup,
} from './auth.ts';

export { createMemoryTokenStore, createTokenListeners } from './session.ts';
export type {
    ContextRepository,
    DeviceRepository,
    MeResponse,
    PendingConsent,
    SessionRepository,
    SessionTokenStore,
    SetContextRequest,
} from './session.ts';

export { SORT_DIRECTIONS, emptyPage } from './pagination.ts';
export type {
    CursorPage,
    CursorPageRequest,
    NumericRangeFilter,
    SortDirection,
} from './pagination.ts';

export { MEAL_SORTS } from './marketplace.ts';
export type {
    DeliveryZone,
    DietCategory,
    Dietitian,
    DietitianFilter,
    Kitchen,
    KitchenBranch,
    KitchenFilter,
    KitchenSalesChannels,
    MarketplaceMeal,
    MarketplaceRepository,
    MealAvailability,
    MealFilter,
    MealSort,
    OpeningHours,
    PlanDurationOption,
    PlanFilter,
    PlanVariant,
    SubscriptionPlan,
} from './marketplace.ts';

export { NUTRITION_REVIEW_STATES, REVIEW_URGENCIES } from './nutrition.ts';
export type {
    NutritionRepository,
    NutritionReview,
    NutritionReviewState,
    RequestNutritionReviewRequest,
    ReviewUrgency,
    StoredNutritionTarget,
    UpdateNutritionTargetRequest,
} from './nutrition.ts';

export {
    MEAL_PLAN_STATES,
    PLAN_ENTRY_KINDS,
    PLAN_HISTORY_ACTIONS,
    PLAN_NOTE_AUTHORS,
    PREPARATION_MODES,
    REPLACEMENT_MODES,
} from './planner.ts';
export type {
    AddEntryRequest,
    AdjustPortionRequest,
    DuplicatePlanRequest,
    GeneratePlanRequest,
    MealPlanDay,
    MealPlanEntry,
    MealPlanRepository,
    MealPlanState,
    MealPlanSummary,
    MealPlanWeek,
    PlanEntryKind,
    PlanHistoryAction,
    PlanHistoryEvent,
    PlanNoteAuthor,
    PlanNotes,
    PreparationMode,
    RegenerateScopeRequest,
    RepeatMealRequest,
    ReplaceEntryRequest,
    ReplacementMode,
    SaveTemplateRequest,
    SetPlanNotesRequest,
} from './planner.ts';

export type {
    Food,
    FoodRepository,
    FoodSearchFilter,
    GroceryList,
    GroceryListItem,
    Pantry,
    PantryItem,
    Recipe,
    RecipeFilter,
    RecipeStep,
} from './foods.ts';

export { VD_MESSAGE_ORIGINS } from './virtual-dietitian.ts';
export type {
    AcceptVdProposalRequest,
    CreateVdSessionRequest,
    GenerateVdDraftRequest,
    OverrideVdProposalRequest,
    RequestVdReviewRequest,
    SendVdMessageRequest,
    VdConstraintConflict,
    VdMealStructureSlot,
    VdMessage,
    VdMessageOrigin,
    VdMissingInformation,
    VdProposal,
    VdSafetyNotice,
    VdSession,
    VdSessionSummary,
    VirtualDietitianRepository,
} from './virtual-dietitian.ts';

export type {
    AddCartItemRequest,
    Cart,
    CartItem,
    ChangeAddressRequest,
    ChangeSlotRequest,
    CheckoutPreview,
    CommerceRepository,
    CreateSubscriptionRequest,
    DeliveryAddress,
    DeliverySlot,
    OrderReference,
    PauseSubscriptionRequest,
    PreviewCheckoutRequest,
    PriceLine,
    SkipDayRequest,
    Subscription,
    SubscriptionConfiguration,
    SubscriptionFilter,
    SubscriptionPreview,
} from './commerce.ts';

export { CATALOGUE_ITEM_KINDS, QUOTATION_STATES } from './business.ts';
export type {
    BusinessRepository,
    CatalogueFilter,
    CatalogueItem,
    CatalogueItemKind,
    CorporateProgramme,
    Quotation,
    QuotationFilter,
    QuotationLine,
    QuotationState,
    RequestQuotationLine,
    RequestQuotationRequest,
    VolumeTier,
} from './business.ts';

export { REVIEW_PRIORITIES, REVIEW_QUEUE_STATES, REVIEW_SUBJECTS } from './professional.ts';
export type {
    ApproveReviewRequest,
    DietitianNote,
    ProfessionalRepository,
    RequestChangesRequest,
    ReviewDetail,
    ReviewPriority,
    ReviewQueueFilter,
    ReviewQueueItem,
    ReviewQueueState,
    ReviewSubject,
    SetDietitianNoteRequest,
    SetOverrideRequest,
} from './professional.ts';

/**
 * The complete data surface a screen may reach. Nothing else is exported to the application: a
 * screen depends on this bundle, never on a transport (plan §18).
 */
export interface Repositories {
    readonly auth: AuthRepository;
    readonly session: SessionRepository;
    readonly context: ContextRepository;
    readonly devices: DeviceRepository;
}

/**
 * The prototype surface — the foundation repositories plus the eight Prompt 2 contracts.
 *
 * ## Why this is a separate interface (the Wave 1.2 seam)
 *
 * The eight new fields are **required**, not optional: an optional repository turns every call site
 * into `repositories.planner?.getWeek(...)`, and the compiler stops being able to prove that both
 * implementations cover the whole surface — which is the entire reason the contracts exist.
 *
 * But adding eight required fields to `Repositories` itself would immediately invalidate the two
 * implementations that already satisfy it (`src/mock/repositories.ts` and `src/api/repositories.ts`)
 * and break `createRepositories` in `src/registry.ts` — none of which this wave owns. So the
 * foundation bundle is left exactly as it was, and the wider surface is declared here.
 *
 * **What Wave 1.2-FIX does with it.** Once the mock world and the API stubs implement all eight,
 * that wave should: widen `createRepositories` to return `PrototypeRepositories`, and then either
 * fold the eight fields into `Repositories` and delete this interface, or keep the split
 * permanently if the foundation ever needs to be consumed without the prototype surface. Either is
 * a one-line decision at that point; neither is available before both implementations exist.
 *
 * Nothing outside this file needs to change in the meantime: a screen that only needs `auth` keeps
 * depending on `Repositories`, and a screen that needs the planner depends on this.
 */
export interface PrototypeRepositories extends Repositories {
    readonly marketplace: MarketplaceRepository;
    readonly nutrition: NutritionRepository;
    readonly planner: MealPlanRepository;
    readonly foods: FoodRepository;
    readonly virtualDietitian: VirtualDietitianRepository;
    readonly commerce: CommerceRepository;
    readonly business: BusinessRepository;
    readonly professional: ProfessionalRepository;
}
