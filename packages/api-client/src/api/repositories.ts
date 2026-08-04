import { UserId } from '@healthy360/domain-types';
import type {
    ActiveContext,
    Device,
    DeviceId,
    UserId as UserIdType,
} from '@healthy360/domain-types';

import type {
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
} from '../contracts/auth.ts';
import { ApiError, apiFailure } from '../contracts/failure.ts';
import type { Repositories } from '../contracts/index.ts';
import type {
    ContextRepository,
    DeviceRepository,
    MeResponse,
    SessionRepository,
    SetContextRequest,
} from '../contracts/session.ts';
import type {
    ActiveContext as WireActiveContext,
    Device as WireDevice,
} from '../generated/types.ts';
import type { ApiClientConfig } from './config.ts';
import { generateRequestId } from './config.ts';
import { createApiAccountRepository } from './account-repository.ts';
import { createApiB2bApplicationRepository } from './b2b-repository.ts';
import { createApiGuestRepository } from './guest-repository.ts';
import { createApiMarketplaceRepository } from './marketplace-repository.ts';
import { createApiBusinessReads } from './business-repository.ts';
import { createApiCartSurface } from './cart-repository.ts';
import { createApiOrderPlacement } from './order-repository.ts';
import {
    API_PROTOTYPE_REPOSITORIES,
    apiCommerceRepository,
    apiKitchenAdminRepository,
} from './prototype-repositories.ts';
import { createApiReferenceReads } from './reference-repository.ts';
import { createApiKitchenAdminReads } from './kitchen-admin-repository.ts';
import { createApiKitchenAdminWrites } from './kitchen-admin-writes.ts';
import { createApiSubscriptionReads } from './subscription-repository.ts';
import { createApiVerificationRepository } from './verification-repository.ts';
import {
    createBranchDirectory,
    mapActiveContext,
    mapDevice,
    mapMeResponse,
    parsePermissionsVersion,
} from './mappers.ts';
import type { WireMePayload } from './mappers.ts';
import { createTransport, readPermissionsVersion } from './transport.ts';
import type { Transport } from './transport.ts';

/**
 * The API implementation of the repository contracts (plan §18).
 *
 * Same interfaces as `createMockRepositories`, same `ApiFailure` codes, same domain shapes — the
 * application cannot tell which one it was handed, which is the only reason the mock is worth
 * having.
 */
export interface ApiRepositories extends Repositories {
    readonly kind: 'api';
    readonly transport: Transport;
}

/**
 * The verification mail can be re-sent six times a minute (docs/api/conventions.md §Rate limits).
 * A successful send returns no cooldown, so the client uses the limiter's window: the button greys
 * out for a minute rather than inviting the person to hammer it into a `429`.
 */
export const RESEND_VERIFICATION_COOLDOWN_SECONDS = 60;

interface PendingTwoFactor {
    readonly email: string;
    readonly password: string;
}

interface TokenPayload {
    readonly token: string;
    readonly token_type: 'Bearer';
    readonly user: {
        readonly id: string;
        readonly email: string;
        readonly email_verified: boolean;
    };
    readonly device: WireDevice;
}

export function createApiRepositories(config: ApiClientConfig): ApiRepositories {
    const transport = createTransport(config);
    const branches = createBranchDirectory();

    /**
     * Session state the wire does not repeat on every response: who we are, which device record
     * carries this token, and the last permission stamp `/me` reported. All of it is in memory
     * only — nothing from an authentication response is ever persisted (plan §21).
     */
    let currentUserId: UserIdType | null = null;
    let currentDeviceId: string | null = null;
    let permissionsVersion: string | null = null;
    /**
     * The sign-in address, as `/me` and the token exchange report it.
     *
     * Held here because `GET /customer-account` does not carry it and `CustomerAccount.loginEmail`
     * requires it — the account header says "signed in as …", and the alternative was a second
     * `/me` from inside the account repository on every overview read.
     */
    let currentLoginEmail = '';

    /**
     * Credentials held for the length of a two-factor challenge.
     *
     * `POST /auth/token` is a single call that either issues a token or answers
     * `auth.two_factor_required`; there is no server-side "pending sign-in" for bearer clients the
     * way there is for cookie sessions. Completing the challenge therefore means repeating the
     * exchange with the code attached, which means holding the password in memory until the person
     * types their code or gives up. It is dropped on success, on cancellation, and on logout, and
     * it never reaches storage.
     */
    const pendingTwoFactor = new Map<string, PendingTwoFactor>();

    function rememberSession(payload: TokenPayload): AuthSession {
        transport.tokenStore.set(payload.token);
        currentUserId = UserId.unsafe(payload.user.id);
        currentDeviceId = payload.device.id;
        currentLoginEmail = payload.user.email;
        return { token: payload.token, userId: currentUserId, expiresAt: null };
    }

    function forgetSession(): void {
        transport.tokenStore.clear();
        transport.context.clear();
        pendingTwoFactor.clear();
        currentUserId = null;
        currentDeviceId = null;
        permissionsVersion = null;
        currentLoginEmail = '';
    }

    /** The user whose data we are showing. Known after any `/auth/token` exchange or `me()`. */
    function requireUserId(): UserIdType {
        if (currentUserId !== null) return currentUserId;
        // Device rows are the caller's by construction (the endpoint is `/me/devices`), so the
        // identifier is only needed to satisfy the domain shape.
        return UserId.unsafe('');
    }

    async function issueToken(input: {
        readonly email: string;
        readonly password: string;
        readonly twoFactorCode?: string | undefined;
        readonly recoveryCode?: string | undefined;
    }): Promise<TokenPayload> {
        return transport.request<TokenPayload>({
            method: 'POST',
            path: '/auth/token',
            anonymous: true,
            body: {
                email: input.email,
                password: input.password,
                device_name: transport.deviceName,
                platform: transport.platform,
                ...(config.clientVersion === undefined
                    ? {}
                    : { app_version: config.clientVersion }),
                ...(input.twoFactorCode === undefined
                    ? {}
                    : { two_factor_code: input.twoFactorCode }),
                ...(input.recoveryCode === undefined ? {} : { recovery_code: input.recoveryCode }),
            },
        });
    }

    const auth: AuthRepository = {
        async login(request: LoginRequest): Promise<LoginResult> {
            try {
                const payload = await issueToken({
                    email: request.email,
                    password: request.password,
                });
                return { status: 'authenticated', session: rememberSession(payload) };
            } catch (caught: unknown) {
                // Two-factor is a *step*, not a failure: the password was accepted and the server
                // is waiting for the second factor (contracts/auth.ts).
                if (caught instanceof ApiError && caught.code === 'auth.two_factor_required') {
                    const challengeId = generateRequestId();
                    pendingTwoFactor.set(challengeId, {
                        email: request.email,
                        password: request.password,
                    });
                    return {
                        status: 'two_factor_required',
                        challengeId,
                        recoveryCodesAvailable: true,
                    };
                }
                throw caught;
            }
        },

        async register(request: RegisterRequest): Promise<RegisterResult> {
            // `name` is one field in the form and two on the wire. Everything before the last space
            // is the given name; a single word is used for both, because `family_name` is required
            // and dropping half of somebody's name would be worse than repeating it.
            const parts = request.name.trim().split(/\s+/);
            const familyName = parts.length > 1 ? parts[parts.length - 1]! : parts[0]!;
            const givenName = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0]!;

            await transport.request<{ user: { id: string } }>({
                method: 'POST',
                path: '/auth/register',
                anonymous: true,
                body: {
                    email: request.email,
                    password: request.password,
                    password_confirmation: request.passwordConfirmation,
                    given_name: givenName,
                    family_name: familyName,
                    ...(request.locale === undefined
                        ? {}
                        : { preferred_language_code: request.locale }),
                    accepts_terms: request.acceptTerms,
                    accepts_privacy: request.acceptPrivacy,
                },
            });

            // Registration returns the account, not a credential: a first-party caller gets a
            // cookie, a bearer caller follows with the token exchange (OpenAPI `/auth/register`).
            // The contract promises a session, so the exchange happens here rather than leaving
            // every screen to remember it.
            const payload = await issueToken({
                email: request.email,
                password: request.password,
            });

            return { session: rememberSession(payload), emailVerified: false };
        },

        /**
         * **Bearer logout is a local act.**
         *
         * `POST /auth/logout` destroys a *session*; it is documented as session-only and a bearer
         * caller reaches it without a first-party `Origin`, which is `request.invalid`. The only
         * server-side revocation available to a token holder is `DELETE /me/devices/{device}`, and
         * that is step-up protected — so it succeeds only if the person confirmed their password in
         * the last three hours.
         *
         * Therefore: try the revocation, ignore whatever it says, and always clear the token. The
         * credential is gone from this device either way; if the server still holds the token it
         * expires on its own and is revocable from the devices screen.
         */
        async logout(): Promise<void> {
            const deviceId = currentDeviceId;
            if (deviceId !== null) {
                try {
                    await transport.requestVoid({
                        method: 'DELETE',
                        path: `/me/devices/${encodeURIComponent(deviceId)}`,
                    });
                } catch {
                    /* Best effort by design — see above. */
                }
            }
            forgetSession();
        },

        async requestPasswordReset(request: { readonly email: string }): Promise<void> {
            await transport.request({
                method: 'POST',
                path: '/auth/forgot-password',
                anonymous: true,
                body: { email: request.email },
            });
        },

        async resetPassword(request: PasswordResetRequest): Promise<void> {
            await transport.request({
                method: 'POST',
                path: '/auth/reset-password',
                anonymous: true,
                body: {
                    token: request.token,
                    email: request.email,
                    password: request.password,
                    password_confirmation: request.passwordConfirmation,
                },
            });
        },

        async verifyEmailStatus(): Promise<EmailVerificationStatus> {
            const payload = await transport.request<WireMePayload>({ method: 'GET', path: '/me' });
            return {
                email: payload.user.email,
                verified: payload.user.email_verified,
                // The wire carries the fact, not the moment (see mappers.ts).
                verifiedAt: null,
            };
        },

        async resendVerification(): Promise<ResendVerificationResult> {
            // `204` when the address is already verified — a documented envelope exception, so this
            // cannot use `request()`.
            await transport.requestVoid({
                method: 'POST',
                path: '/auth/email/verification-notification',
            });
            return { cooldownSeconds: RESEND_VERIFICATION_COOLDOWN_SECONDS };
        },

        async confirmPassword(request: {
            readonly password: string;
        }): Promise<PasswordConfirmationResult> {
            const data = await transport.request<{ confirmed: boolean; timeout_seconds: number }>({
                method: 'POST',
                path: '/auth/confirm-password',
                body: { password: request.password },
            });

            if (!data.confirmed) {
                throw new ApiError(apiFailure('auth.invalid_credentials'));
            }

            return {
                confirmedUntil: new Date(Date.now() + data.timeout_seconds * 1000).toISOString(),
            };
        },

        async enableTwoFactor(): Promise<TwoFactorSetup> {
            await transport.request({ method: 'POST', path: '/auth/two-factor-authentication' });

            const [secret, qr, recovery] = await Promise.all([
                transport.request<{ secret_key: string }>({
                    method: 'GET',
                    path: '/auth/two-factor-secret-key',
                }),
                transport.request<{ svg: string; url: string }>({
                    method: 'GET',
                    path: '/auth/two-factor-qr-code',
                }),
                transport.request<{ recovery_codes: string[] }>({
                    method: 'GET',
                    path: '/auth/two-factor-recovery-codes',
                }),
            ]);

            return {
                secret: secret.secret_key,
                otpauthUri: qr.url,
                recoveryCodes: recovery.recovery_codes,
            };
        },

        async confirmTwoFactor(request: { readonly code: string }): Promise<void> {
            await transport.request({
                method: 'POST',
                path: '/auth/confirmed-two-factor-authentication',
                body: { code: request.code },
            });
        },

        async challengeTwoFactor(request: TwoFactorChallengeRequest): Promise<AuthSession> {
            const pending = pendingTwoFactor.get(request.challengeId);
            if (pending === undefined) {
                // The challenge expired with the page, or was already spent.
                throw new ApiError(apiFailure('auth.invalid_credentials'));
            }

            const payload = await issueToken({
                email: pending.email,
                password: pending.password,
                ...(request.recovery === true
                    ? { recoveryCode: request.code }
                    : { twoFactorCode: request.code }),
            });

            pendingTwoFactor.delete(request.challengeId);
            return rememberSession(payload);
        },
    };

    const session: SessionRepository = {
        async me(): Promise<MeResponse> {
            const envelope = await transport.requestEnvelope<WireMePayload>({
                method: 'GET',
                path: '/me',
            });

            permissionsVersion = readPermissionsVersion(envelope.meta);
            const me = mapMeResponse(envelope.data, permissionsVersion, branches);

            currentUserId = me.user.id;
            currentLoginEmail = me.user.email;
            transport.context.set(
                me.activeContext?.organisationId ?? null,
                me.activeContext?.branchId ?? null,
            );

            return me;
        },
    };

    const context: ContextRepository = {
        async setContext(request: SetContextRequest): Promise<ActiveContext> {
            const data = await transport.request<{ active_context: WireActiveContext }>({
                method: 'PUT',
                path: '/me/context',
                body: {
                    organisation_id: request.organisationId,
                    ...(request.branchId === undefined ? {} : { branch_id: request.branchId }),
                },
            });

            const applied = mapActiveContext(
                data.active_context,
                parsePermissionsVersion(permissionsVersion),
                branches,
            );

            if (applied === null) {
                // The endpoint answers `403` when it refuses; a `200` with a null context would
                // mean the server applied nothing while reporting success.
                throw new ApiError(apiFailure('context.organisation_forbidden'));
            }

            transport.context.set(applied.organisationId, applied.branchId);
            return applied;
        },
    };

    const devices: DeviceRepository = {
        async list(): Promise<readonly Device[]> {
            const data = await transport.request<WireDevice[]>({
                method: 'GET',
                path: '/me/devices',
            });
            const userId = requireUserId();
            return data.map((device) => mapDevice(device, userId));
        },

        async revoke(deviceId: DeviceId): Promise<void> {
            await transport.requestVoid({
                method: 'DELETE',
                path: `/me/devices/${encodeURIComponent(deviceId)}`,
            });

            // Revoking the credential this request was made with is allowed and takes effect
            // immediately, so the local session has to end with it.
            if (deviceId === currentDeviceId) forgetSession();
        },
    };

    /**
     * The four journey repositories, and the reference reads two of them share.
     *
     * `verification` is built first because `account` reads contacts through it: the overview
     * re-exposes them read-only so a checklist screen does not need two round trips, and going
     * through the repository rather than repeating the request means one place decides how a
     * contact is shaped.
     */
    const reference = createApiReferenceReads(transport);
    const verification = createApiVerificationRepository(transport);
    const kitchenAdminReads = createApiKitchenAdminReads(transport);
    const kitchenAdminWrites = createApiKitchenAdminWrites(transport);
    const businessReads = createApiBusinessReads(transport);
    const account = createApiAccountRepository({
        transport,
        reference,
        verification,
        // `/customer-account` carries no sign-in address. The one `/me` reported is remembered by
        // the session machinery above; an empty string before the first `me()` is honest — the
        // account screens are behind the session guard and never render before it resolves.
        loginEmail: () => currentLoginEmail,
    });

    // Prototype stubs remain the base for families still without HTTP; wired surfaces override.
    return {
        kind: 'api',
        transport,
        auth,
        session,
        context,
        devices,
        verification,
        account,
        guest: createApiGuestRepository(transport),
        b2bApplication: createApiB2bApplicationRepository(transport),
        marketplace: createApiMarketplaceRepository(transport),
        ...API_PROTOTYPE_REPOSITORIES,
        business: {
            ...API_PROTOTYPE_REPOSITORIES.business,
            ...businessReads,
        },
        commerce: {
            ...apiCommerceRepository,
            ...createApiCartSurface(transport),
            placeOrder: createApiOrderPlacement(transport),
            ...createApiSubscriptionReads(transport),
        },
        kitchenAdmin: {
            ...apiKitchenAdminRepository,
            listAllergenClasses: reference.listAllergenClasses,
            listServiceAreas: reference.listServiceAreas,
            ...kitchenAdminReads,
            ...kitchenAdminWrites,
        },
    };
}
