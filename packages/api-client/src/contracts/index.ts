import type { AccountRepository } from './account.ts';
import type { AuthRepository } from './auth.ts';
import type { B2BApplicationRepository } from './b2b-application.ts';
import type { BusinessRepository } from './business.ts';
import type { GuestRepository } from './guest.ts';
import type { InvitationsRepository } from './invitations.ts';
import type { CommerceRepository } from './commerce.ts';
import type { FoodRepository } from './foods.ts';
import type { KitchenAdminRepository } from './kitchen-admin.ts';
import type { KitchenOpsRepository } from './kitchen-ops.ts';
import type { KitchenOrdersRepository } from './kitchen-orders.ts';
import type { MarketplaceRepository } from './marketplace.ts';
import type { NutritionRepository } from './nutrition.ts';
import type { MealPlanRepository } from './planner.ts';
import type { PlatformAdminRepository } from './platform-admin.ts';
import type { ProfessionalRepository } from './professional.ts';
import type { ContextRepository, DeviceRepository, SessionRepository } from './session.ts';
import type { VerificationRepository } from './verification.ts';
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
    isOrderPlacementRefusedFailure,
    isOtpCooldownFailure,
    isOtpFailure,
    isOtpInvalidFailure,
    isOtpLockedFailure,
    isPermissionDeniedFailure,
    isRateLimitFailure,
    isValidationFailure,
    otpCooldownFailure,
    otpInvalidFailure,
    orderPlacementRefusedFailure,
    otpLockedFailure,
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
    SubscriptionRefusal,
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

export { SORT_DIRECTIONS, emptyPage, pageCount } from './pagination.ts';
export type {
    CursorPage,
    CursorPageRequest,
    NumericRangeFilter,
    OffsetPageRequest,
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
    KitchenDeliveryWindow,
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

export {
    MEAL_CHOICE_SOURCES,
    ORDER_STATES,
    SUBSCRIPTION_DELIVERY_STATUSES,
    SUBSCRIPTION_QUOTE_REFUSALS,
    SUBSCRIPTION_SKIP_REASONS,
} from './commerce.ts';
export type {
    AddCartItemRequest,
    CancelSubscriptionRequest,
    Cart,
    CartItem,
    ChangeAddressRequest,
    ChangeSlotRequest,
    CheckoutPreview,
    CommerceRepository,
    CreateSubscriptionRequest,
    CreditMemo,
    DeliveryAddress,
    DeliverySlot,
    MealChoiceSource,
    OrderReference,
    OrderState,
    PauseSubscriptionRequest,
    PlaceOrderRequest,
    PlacedOrder,
    PlacedOrderLine,
    PreviewCheckoutRequest,
    PriceLine,
    SetSubscriptionMealChoicesRequest,
    SetSubscriptionWeekdaysRequest,
    SkipDayRequest,
    Subscription,
    SubscriptionBalance,
    SubscriptionCancellation,
    SubscriptionConfiguration,
    SubscriptionDays,
    SubscriptionDelivery,
    SubscriptionDeliveryFilter,
    SubscriptionDeliveryStatus,
    SubscriptionFilter,
    SubscriptionMealChoice,
    SubscriptionPreview,
    SubscriptionQuote,
    SubscriptionQuoteRefusal,
    SubscriptionQuoteRequest,
    SubscriptionSkipReason,
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

export {
    PRODUCTION_ORDER_STATUSES,
    QUALITY_CHECK_STATUSES,
    QUALITY_CHECK_SUBJECT_TYPES,
    STOCK_MOVEMENT_REASONS,
} from './kitchen-ops.ts';
export type {
    CompleteProductionOrderRequest,
    CreateProductionOrderRequest,
    CreateQualityCheckRequest,
    CreateStockItemRequest,
    GoodsReceipt,
    GoodsReceiptLine,
    GoodsReceiptLineInput,
    GoodsReceiptResult,
    KitchenOpsRepository,
    PostGoodsReceiptRequest,
    ProductionMovementInput,
    ProductionOrder,
    ProductionOrderResult,
    ProductionOrderStatus,
    PurchaseLedgerFilter,
    PurchaseLedgerLine,
    QualityCheck,
    QualityCheckResult,
    QualityCheckStatus,
    QualityCheckSubjectType,
    SetStockThresholdRequest,
    StockAdjustmentRequest,
    StockItem,
    StockLevel,
    StockMovement,
    StockMovementReason,
    StockWasteRequest,
    Supplier,
    SupplierRef,
} from './kitchen-ops.ts';

export {
    KITCHEN_ORDER_CANCELLATION_REASONS,
    KITCHEN_ORDER_OPEN_STATUSES,
    KITCHEN_ORDER_PAYMENT_METHODS,
    KITCHEN_ORDER_STATUSES,
} from './kitchen-orders.ts';
export type {
    CancelKitchenOrderRequest,
    KitchenOrder,
    KitchenOrderCancellationReason,
    KitchenOrderDelivery,
    KitchenOrderFilters,
    KitchenOrderLine,
    KitchenOrderLineAllergen,
    KitchenOrderPage,
    KitchenOrderPaymentMethod,
    KitchenOrdersRepository,
    KitchenOrderStatus,
    KitchenOrderTransitionRequest,
} from './kitchen-orders.ts';

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

/* ------------------------------------------------------------------------------------------------
 * The four journey contracts (J1, G1, B1), registered by the integrator wave.
 *
 * Each was declared standalone and unregistered while its mock world and its screens were built,
 * for the reason each file's header gives: adding a required field to a bundle nothing satisfies
 * breaks every consumer at once. Both implementations now exist — the fixture worlds under
 * `../mock/{account,guest,b2b-application}/` and the HTTP repositories under `../api/` — so the
 * fields are required like the other thirteen and the three application-side shims that probed for
 * them are deleted.
 * ---------------------------------------------------------------------------------------------- */

export { CONTACT_KINDS, OTP_CHANNELS, OTP_PURPOSES } from './verification.ts';
export type {
    AddContactPointRequest,
    ContactKind,
    ContactPoint,
    ContactPointAdded,
    IssueOtpRequest,
    OtpChallenge,
    OtpChannel,
    OtpPurpose,
    OtpVerificationResult,
    ResendOtpRequest,
    VerificationRepository,
    VerifyOtpRequest,
} from './verification.ts';

export {
    ACCOUNT_CHECKLIST_STEPS,
    ACCOUNT_LIFECYCLES,
    ALLERGEN_SEVERITIES,
    CLOSURE_BLOCKER_CODES,
    CLOSURE_BLOCKER_STATUSES,
    CLOSURE_REASON_CODES,
    CLOSURE_REQUEST_STATUSES,
    CLOSURE_SCOPES,
} from './account.ts';
export type {
    AccountChecklistItem,
    AccountChecklistStep,
    AccountLifecycle,
    AccountOverview,
    AccountRepository,
    AccountServiceArea,
    AccountSetupChecklist,
    AllergenDeclaration,
    AllergenSeverity,
    ClosureBlocker,
    ClosureBlockerCode,
    ClosureBlockerStatus,
    ClosurePreconditions,
    ClosureReasonCode,
    ClosureRequestStatus,
    ClosureScope,
    ClosureTicket,
    ConsentDefinition,
    ConsentState,
    CustomerAccount,
    CustomerAddress,
    DietaryProfile,
    RequestClosureRequest,
    SaveAddressRequest,
    SaveDietaryProfileRequest,
    SetConsentRequest,
    VerifyClosureRequest,
} from './account.ts';

export {
    GUEST_CAPABILITIES,
    GUEST_ORDER_STATES,
    GUEST_PAYMENT_METHODS,
    GUEST_SESSION_GRADES,
} from './guest.ts';
export type {
    ConfirmGuestContactRequest,
    ConfirmGuestDeletionRequest,
    ConvertGuestRequest,
    GuestCapability,
    GuestCheckoutDraft,
    GuestContact,
    GuestContactChallenge,
    GuestConversionPrefill,
    GuestConversionResult,
    GuestDeletionAcknowledgement,
    GuestDeletionOutcome,
    GuestOrder,
    GuestOrderLine,
    GuestOrderState,
    GuestPaymentMethod,
    GuestRepository,
    GuestSession,
    GuestSessionGrade,
    RequestGuestDeletionRequest,
    StartGuestSessionRequest,
    UpdateGuestContactRequest,
} from './guest.ts';

export {
    AGREEMENT_SIGNATURE_KINDS,
    AGREEMENT_STATUSES,
    B2B_APPLICATION_SECTIONS,
    B2B_APPLICATION_STATES,
    B2B_BUSINESS_TYPES,
    B2B_DELIVERY_WINDOWS,
    B2B_DOCUMENT_KINDS,
    B2B_ORDER_FREQUENCIES,
    B2B_PAYMENT_TERMS,
    B2B_PRODUCT_CATEGORIES,
    B2B_VOLUME_BANDS,
    KYC_REJECTION_REASONS,
    KYC_REVIEW_STATUSES,
    OFFBOARDING_STATUSES,
    OFFBOARDING_TRIGGERS,
    PROVISIONING_STEPS,
    SETTLEMENT_CHECK_CODES,
    SETTLEMENT_OUTCOMES,
    SETTLEMENT_STATUSES,
} from './b2b-application.ts';
export type {
    AgreementSignatureKind,
    AgreementStatus,
    AgreementTerms,
    B2BAgreement,
    B2BApplication,
    B2BApplicationRepository,
    B2BApplicationSection,
    B2BApplicationSectionState,
    B2BApplicationSections,
    B2BApplicationState,
    B2BBusinessType,
    B2BCompanySection,
    B2BDeliveryWindow,
    B2BDocumentKind,
    B2BLogisticsSection,
    B2BOffboarding,
    B2BOrderFrequency,
    B2BPaymentTerms,
    B2BProductCategory,
    B2BSectionPayload,
    B2BSignatorySection,
    B2BTradeTermsSection,
    B2BVolumeBand,
    DocumentDownload,
    KycDocument,
    KycRejectionReason,
    KycReviewStatus,
    OffboardingArchive,
    OffboardingRevocation,
    OffboardingSettlement,
    OffboardingSignoff,
    OffboardingStatus,
    OffboardingTrigger,
    ProvisioningProgress,
    ProvisioningStep,
    ProvisioningStepState,
    ReviewerRequest,
    SettlementCheck,
    SettlementCheckCode,
    SettlementOutcome,
    SettlementStatus,
    SignAgreementRequest,
    SignOffOffboardingRequest,
    SignatureEvidence,
    UploadDocumentRequest,
} from './b2b-application.ts';

/* ------------------------------------------------------------------------------------------------
 * PA1 — platform administration of kitchen tenants.
 *
 * Registered in the bundle on the day it was written, unlike the four journey families above. They
 * were declared standalone because their screens were built before their endpoints existed, and a
 * required field on a bundle nothing satisfies breaks every consumer at once. This family had both
 * implementations before it had a screen — the routes shipped with the same phase — so there was
 * never a window in which registering it would have cost anything.
 * ---------------------------------------------------------------------------------------------- */

export { INVITATION_STATUSES, isAcceptable } from './invitations.ts';
export type {
    AcceptedInvitation,
    Invitation,
    InvitationOrganisation,
    InvitationStatus,
    InvitationsRepository,
} from './invitations.ts';

export { KITCHEN_TENANT_STATUSES, isReactivatable, isTradingStatus } from './platform-admin.ts';
export type {
    CreateKitchenRequest,
    InviteOwnerRequest,
    KitchenCatalogueCounts,
    KitchenTenantFilter,
    KitchenTenantStatus,
    LockedPlatformRequest,
    OwnerInvitation,
    OwnerRevocation,
    PlatformAdminRepository,
    PlatformKitchen,
    PlatformKitchenBranch,
    PlatformKitchenOwner,
    PlatformKitchenSummary,
    SuspendKitchenRequest,
} from './platform-admin.ts';

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
 *
 * ## Thirteen became seventeen
 *
 * `verification`, `account`, `guest` and `b2bApplication` joined together in the integrator wave.
 * They were declared standalone for two phases while their screens were built against the mock
 * worlds, and the application reached them through three probing shims under
 * `apps/universal/src/features/*` that resolved a field the bundle might or might not carry. That
 * arrangement bought exactly one thing — the ability to ship the screens before the endpoints —
 * and cost the property this bundle exists for: the compiler could not prove the two
 * implementations covered the same surface, and in `api` mode every one of those screens called a
 * `Proxy` that threw. The endpoints exist now, so the fields are required and the shims are gone.
 */
export interface Repositories {
    /**
     * Which implementation the application was handed.
     *
     * Both implementations already carried this as their own discriminant; it is declared here so a
     * screen can ask without narrowing to `ApiRepositories` or `MockRepositories` first. The one
     * legitimate use is a surface that exists **only** in the fixture world and has to say so
     * honestly in `api` mode — never a behaviour switch inside a surface both implementations
     * cover, which would be the mock and the API quietly diverging.
     *
     * Gate on this rather than on a build flag: a test harness injects mock repositories while the
     * build's configured data mode is already `api`, so the flag and the truth disagree.
     */
    readonly kind: 'api' | 'mock';

    readonly auth: AuthRepository;
    readonly session: SessionRepository;
    readonly context: ContextRepository;
    readonly devices: DeviceRepository;

    readonly verification: VerificationRepository;
    readonly account: AccountRepository;
    readonly guest: GuestRepository;
    readonly b2bApplication: B2BApplicationRepository;

    readonly marketplace: MarketplaceRepository;
    readonly nutrition: NutritionRepository;
    readonly planner: MealPlanRepository;
    readonly foods: FoodRepository;
    readonly virtualDietitian: VirtualDietitianRepository;
    readonly commerce: CommerceRepository;
    readonly business: BusinessRepository;
    readonly professional: ProfessionalRepository;
    readonly kitchenAdmin: KitchenAdminRepository;
    /**
     * Inventory, receipts-only procurement, production and quality control (O1–O4).
     *
     * A sibling of `kitchenAdmin` rather than a branch of it — see `./kitchen-ops.ts`'s header for
     * why the two contracts do not share a shape.
     */
    readonly kitchenOps: KitchenOpsRepository;

    /**
     * The orders placed against this kitchen, and the three actions that move them.
     *
     * A sibling of `commerce` rather than a branch of it. `commerce` is the *buyer's* order — a
     * receipt, with no tariff, no delivery zone and no lock version on it — and this one is the
     * seller's, which carries all three because this is the audience that writes. See
     * `./kitchen-orders.ts`'s header for why the two shapes are built independently rather than one
     * being the other minus some fields.
     */
    readonly kitchenOrders: KitchenOrdersRepository;

    /**
     * Platform administration of kitchen tenants (PA1) — the nineteenth field.
     *
     * Not a branch of `kitchenAdmin` and never could be. That contract is a kitchen managing
     * itself; this one is the platform managing kitchens, and the only shape they share is the word
     * "kitchen". Required like the rest: `/platform-admin` is a route area, and an optional
     * repository would put a `?.` in front of every call and stop the compiler proving the mock and
     * the API implementations cover the same surface.
     */
    readonly platformAdmin: PlatformAdminRepository;

    /**
     * Taking up an offer of membership (PA1) — the twentieth field.
     *
     * Required like the rest, and required for a reason the others do not have: `getInvitation` is
     * the one call on this bundle that is answered with **no credential at all**, so the screen
     * behind it renders for a visitor who is not signed in and may have no account. An optional
     * field would put a `?.` in front of the first thing that visitor's browser does.
     *
     * Not a branch of `platformAdmin` — that is the operator issuing invitations from behind two
     * platform gates — and not a branch of `account`, because the acceptor may not have one. See
     * `./invitations.ts` for the full argument.
     */
    readonly invitations: InvitationsRepository;
}
