/**
 * `@healthy360/api-client` — the boundary between screens and data (plan §18).
 *
 * Phase 5b ships the *contracts* and a mock implementation. Phase 5c adds the `@hey-api` generated
 * client and the `ApiRepository` behind the same interfaces; nothing above this package changes
 * when it does, which is the entire purpose of the split.
 */
export {
    API_FAILURE_CODES,
    ApiError,
    apiFailure,
    asApiFailure,
    createMemoryTokenStore,
    createTokenListeners,
    defaultRetryable,
    isApiFailure,
    isApiFailureCode,
    isAutoRetryable,
    isRateLimitFailure,
    isValidationFailure,
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

export {
    ApiRepositoriesUnavailableError,
    MockDataInProductionError,
    REPOSITORY_APP_ENVS,
    createRepositories,
} from './registry.ts';
export type { RepositoryAppEnv, RepositoryConfig } from './registry.ts';

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
