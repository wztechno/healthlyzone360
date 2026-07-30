import type { AuthRepository } from './auth.ts';
import type { ContextRepository, DeviceRepository, SessionRepository } from './session.ts';

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
