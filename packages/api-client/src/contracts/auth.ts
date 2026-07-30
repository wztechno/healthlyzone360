import type { IsoDateTime, Locale, UserId } from '@healthy360/domain-types';

/**
 * Authentication contract (plan §13, §14).
 *
 * Every method rejects with an `ApiError` carrying an `ApiFailure`; success types below describe
 * only the happy path, which keeps the screens' branching to `try` / `catch (failure.code)`.
 */

/**
 * An issued session.
 *
 * `token` is opaque. On native it is a Sanctum personal access token; on web the browser holds the
 * session cookie and the token is only a marker that a session exists. Either way the client stores
 * *this string and nothing else* — never the user record (plan §21: no authentication responses on
 * disk).
 */
export interface AuthSession {
    readonly token: string;
    readonly userId: UserId;
    readonly expiresAt: IsoDateTime | null;
}

export interface LoginRequest {
    readonly email: string;
    readonly password: string;
    readonly remember?: boolean | undefined;
}

/**
 * Two-factor is a *step in the login*, not a separate failure: the server has accepted the password
 * and is holding a short-lived challenge. Modelling it as a success variant stops every caller from
 * having to treat one specific error code as "actually fine".
 */
export type LoginResult =
    | { readonly status: 'authenticated'; readonly session: AuthSession }
    | {
          readonly status: 'two_factor_required';
          readonly challengeId: string;
          /** Whether recovery codes are accepted in place of a TOTP code. */
          readonly recoveryCodesAvailable: boolean;
      };

export interface RegisterRequest {
    readonly name: string;
    readonly email: string;
    readonly password: string;
    readonly passwordConfirmation: string;
    readonly acceptTerms: boolean;
    readonly acceptPrivacy: boolean;
    readonly locale?: Locale | undefined;
}

export interface RegisterResult {
    readonly session: AuthSession;
    /** Registration never yields a verified address; carried explicitly so the caller need not infer. */
    readonly emailVerified: false;
}

export interface PasswordResetRequest {
    readonly token: string;
    readonly email: string;
    readonly password: string;
    readonly passwordConfirmation: string;
}

export interface EmailVerificationStatus {
    readonly email: string;
    readonly verified: boolean;
    readonly verifiedAt: IsoDateTime | null;
}

export interface ResendVerificationResult {
    /** Seconds before another send is accepted; a further attempt inside it is rate-limited. */
    readonly cooldownSeconds: number;
}

/** Result of `POST /api/v1/auth/confirm-password` — satisfies a step-up challenge. */
export interface PasswordConfirmationResult {
    readonly confirmedUntil: IsoDateTime;
}

export interface TwoFactorSetup {
    /** Base32 shared secret. Shown once, never persisted by the client. */
    readonly secret: string;
    readonly otpauthUri: string;
    readonly recoveryCodes: readonly string[];
}

export interface TwoFactorChallengeRequest {
    readonly challengeId: string;
    readonly code: string;
    /** True when `code` is a recovery code rather than a TOTP code. */
    readonly recovery?: boolean | undefined;
}

export interface AuthRepository {
    login(request: LoginRequest): Promise<LoginResult>;
    register(request: RegisterRequest): Promise<RegisterResult>;
    logout(): Promise<void>;

    requestPasswordReset(request: { readonly email: string }): Promise<void>;
    resetPassword(request: PasswordResetRequest): Promise<void>;

    verifyEmailStatus(): Promise<EmailVerificationStatus>;
    resendVerification(): Promise<ResendVerificationResult>;

    /** Step-up authentication for sensitive actions (plan §13). */
    confirmPassword(request: { readonly password: string }): Promise<PasswordConfirmationResult>;

    enableTwoFactor(): Promise<TwoFactorSetup>;
    confirmTwoFactor(request: { readonly code: string }): Promise<void>;
    challengeTwoFactor(request: TwoFactorChallengeRequest): Promise<AuthSession>;
}
