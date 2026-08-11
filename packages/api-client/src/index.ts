/**
 * `@healthy360/api-client` — the boundary between screens and data (plan §18).
 *
 * Two implementations sit behind one set of contracts: the fixture world in `./mock` and the real
 * transport in `./api`, the latter typed by the OpenAPI document through `./generated`. Nothing
 * above this package can tell them apart, which is the entire purpose of the split.
 */
export {
    API_FAILURE_CODES,
    ApiError,
    apiFailure,
    asApiFailure,
    conflictFailure,
    createMemoryTokenStore,
    createTokenListeners,
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
} from './contracts/index.ts';

export type {
    ApiFailure,
    ApiFailureCode,
    AuthRepository,
    AuthSession,
    ContextRepository,
    DeviceRepository,
    EmailVerificationStatus,
    FailureOptions,
    LoginRequest,
    LoginResult,
    MeResponse,
    PasswordConfirmationResult,
    PasswordResetRequest,
    PendingConsent,
    RegisterRequest,
    RegisterResult,
    Repositories,
    ResendVerificationResult,
    SessionRepository,
    SessionTokenStore,
    SetContextRequest,
    TwoFactorChallengeRequest,
    TwoFactorSetup,
    ValidationFields,
} from './contracts/index.ts';

/**
 * The nine proposed repository interfaces — the eight from Prompt 2 plus K1's `kitchenAdmin`.
 *
 * Only the *interfaces*: the models, filters and request shapes they trade in are a large
 * vocabulary, and a screen imports those from `@healthy360/api-client/contracts` rather than
 * inflating the package root. No fixture is exported from anywhere in this package — a screen that
 * reaches for one is reaching past the seam the whole layer exists to hold.
 */
export type {
    BusinessRepository,
    CommerceRepository,
    CursorPage,
    CursorPageRequest,
    FoodRepository,
    KitchenAdminRepository,
    MarketplaceRepository,
    MealPlanRepository,
    NumericRangeFilter,
    NutritionRepository,
    PlatformAdminRepository,
    ProfessionalRepository,
    VirtualDietitianRepository,
} from './contracts/index.ts';

export {
    MissingApiBaseUrlError,
    MockDataInProductionError,
    REPOSITORY_APP_ENVS,
    createRepositories,
} from './registry.ts';
export type { KeyValueStorage, RepositoryAppEnv, RepositoryConfig } from './registry.ts';

/**
 * The API base URL default, so the application can show what it will talk to. The repositories
 * themselves stay behind the dynamic import in `createRepositories`.
 */
export { DEFAULT_API_BASE_URL } from './api/config.ts';
export type { ClientPlatform } from './api/config.ts';

/**
 * Scenario metadata is re-exported from the package root because the development banner and the
 * Playwright harness need the *names* without pulling the fixture world into the bundle. The
 * repositories themselves stay behind the dynamic import in `createRepositories`.
 */
export {
    DEFAULT_MOCK_SCENARIO,
    MOCK_SCENARIOS,
    MOCK_SCENARIO_NAMES,
    isMockScenarioName,
} from './mock/scenarios.ts';
export type { MockScenario, MockScenarioName } from './mock/scenarios.ts';

export { SORT_DIRECTIONS, emptyPage, pageCount } from './contracts/index.ts';
export {
    REPOSITORY_SURFACE,
    REPOSITORY_SURFACE_KEYS,
    REPOSITORY_SURFACE_METHOD_COUNT,
} from './contracts/repository-surface.ts';
export type { RepositorySurfaceKey } from './contracts/repository-surface.ts';

/**
 * The guest credential's store (plan Phase G1).
 *
 * Exported from the root beside `SessionTokenStore` because the application supplies a
 * platform-appropriate one for exactly the same reason, and for one that is specific to this
 * credential: the web implementation belongs in `sessionStorage` and the native one in the
 * keychain, which is a split only the application can make. `GuestRepository` itself is *not*
 * exported — it is still a standalone contract awaiting registration, like `AccountRepository`.
 */
export {
    GUEST_TOKEN_KEY,
    createGuestTokenStore,
    createMemoryGuestTokenStore,
} from './session/index.ts';
export type { GuestTokenStore } from './session/index.ts';
