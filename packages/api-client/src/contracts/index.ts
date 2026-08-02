import type { AuthRepository } from './auth.ts';
import type { BusinessRepository } from './business.ts';
import type { CommerceRepository } from './commerce.ts';
import type { FoodRepository } from './foods.ts';
import type { KitchenAdminRepository } from './kitchen-admin.ts';
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
    conflictFailure,
    defaultRetryable,
    isApiFailure,
    isApiFailureCode,
    isAutoRetryable,
    isConflictFailure,
    isPermissionDeniedFailure,
    isRateLimitFailure,
    isValidationFailure,
    permissionDeniedFailure,
    rateLimitFailure,
    throwFailure,
    validationFailure,
} from './failure.ts';
export type {
    ApiFailure,
    ApiFailureCode,
    ConflictFailureOptions,
    FailureOptions,
    ValidationFields,
} from './failure.ts';

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

export {
    ALLERGEN_CONTAINMENTS,
    ALLERGEN_DECLARATION_ORIGINS,
    ALLERGEN_VERIFICATIONS,
    CONSUMER_VISIBLE_STATUSES,
    COST_DECIMAL_PLACES,
    PLAN_DURATION_KINDS,
    PRICE_STATUSES,
    PUBLISHABLE_STATUSES,
    isConsumerVisible,
    isPlanDurationConsistent,
    isPriceEntryConsistent,
} from './kitchen-admin.ts';
export type {
    AdminEntityMeta,
    AdminRecordMeta,
    AllergenClass,
    AllergenContainment,
    AllergenDeclarationOrigin,
    AllergenSource,
    AllergenVerification,
    BranchOperating,
    BranchOperatingDay,
    CatalogueItemRef,
    ChannelAvailability,
    CostAmount,
    CreateDeliveryZoneRequest,
    CreateIngredientRequest,
    CreateMealRequest,
    CreatePlanRequest,
    CreateProductRequest,
    CreateRecipeRequest,
    DeliveryWindow,
    DeliveryWindowInput,
    DeliveryZoneAdmin,
    DeliveryZoneAdminFilter,
    IngredientAdmin,
    IngredientAdminFilter,
    IngredientAllergenMapping,
    KitchenAdminRepository,
    LocalisedText,
    LockedRequest,
    MealAdmin,
    MealAdminFilter,
    MealAvailabilityDay,
    PlanAdmin,
    PlanAdminFilter,
    PlanCombination,
    PlanDurationAdmin,
    PlanDurationKind,
    PlanVariantAdmin,
    PlanVariantInput,
    PriceListAdmin,
    PriceListAdminFilter,
    PriceListEntry,
    PriceStatus,
    ProductAdmin,
    ProductAdminFilter,
    ProductPackVariant,
    PublishableStatus,
    RecipeAdmin,
    RecipeAdminFilter,
    RecipeAdminSummary,
    RecipeAllergenDeclaration,
    RecipeLine,
    RecipeLineInput,
    RecipeOutput,
    RecipeOutputInput,
    RecipeRollupDraft,
    RecipeRollupPreview,
    RecipeStepAdmin,
    RecipeStepInput,
    RecipeVersionAdmin,
    RecipeVersionSummary,
    RollupWarning,
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
} from './kitchen-admin.ts';

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
 *
 * ## The thirteen fields are all required, and that is the point
 *
 * Wave 1.1 declared the eight Prompt 2 contracts behind a separate `PrototypeRepositories` interface
 * because neither implementation existed yet, and adding required fields to a bundle nothing
 * satisfies breaks every consumer at once. Wave 1.2 built both — the fixture world in
 * `../mock/prototype/` and the written-out rejections in `../api/prototype-repositories.ts` — so the
 * split has been folded away and the extra interface deleted.
 *
 * Required rather than optional is deliberate. An optional repository turns every call site into
 * `repositories.planner?.getWeek(...)`, and the compiler stops being able to prove that both
 * implementations cover the whole surface, which is the entire reason the contracts exist. With them
 * required, adding a method to any contract fails the build in exactly two places — the mock and the
 * API stub — which is where it should fail.
 *
 * The nine are *proposed*, not implemented: against the real API every one of them rejects with
 * `prototype.not_implemented` naming the endpoint it would have called. A screen therefore compiles
 * against the same surface in both modes and differs only in what it renders when the call fails.
 *
 * `kitchenAdmin` joined in K1 as the thirteenth field. It is required like the rest — the kitchen
 * workspace is a route area, not an optional add-on, and an optional repository would put a `?.` in
 * front of every management call and stop the compiler proving the two implementations match.
 */
export interface Repositories {
    readonly auth: AuthRepository;
    readonly session: SessionRepository;
    readonly context: ContextRepository;
    readonly devices: DeviceRepository;

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
