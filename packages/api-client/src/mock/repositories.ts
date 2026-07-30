import type { ActiveContext, Device, DeviceId } from '@healthy360/domain-types';

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
import type { Repositories } from '../contracts/index.ts';
import type {
    ContextRepository,
    DeviceRepository,
    MeResponse,
    SessionRepository,
    SessionTokenStore,
    SetContextRequest,
} from '../contracts/session.ts';
import { createMemoryTokenStore } from '../contracts/session.ts';
import { createPrototypeRepositories } from './prototype/repositories.ts';
import type { PrototypeStore } from './prototype/store.ts';
import { DEFAULT_MOCK_SCENARIO, resolveScenario } from './scenarios.ts';
import type { MockScenario, MockScenarioName } from './scenarios.ts';
import { MockStore } from './store.ts';
import type { ContextPersistence } from './store.ts';
import type { Clock } from './store.ts';

/** Simulated round trip. Deliberately constant: a jittered mock makes tests flaky for no benefit. */
export const DEFAULT_MOCK_LATENCY_MS = 200;

export interface MockRepositoriesOptions {
    readonly scenario?: MockScenarioName | undefined;
    /** Set to `0` in unit tests. */
    readonly latencyMs?: number | undefined;
    readonly tokenStore?: SessionTokenStore | undefined;
    readonly now?: Clock | undefined;
    /** Persists last-applied contexts across page loads, mirroring the real backend. */
    readonly contexts?: ContextPersistence | undefined;
}

export interface MockRepositories extends Repositories {
    readonly kind: 'mock';
    readonly scenario: MockScenario;
    readonly tokenStore: SessionTokenStore;
    /**
     * The mutable prototype world, exposed so a test can assert what a mutation did without going
     * back through a repository. Screens never touch it — they only ever see `Repositories`.
     */
    readonly prototypeStore: PrototypeStore;
}

function sleep(ms: number): Promise<void> {
    return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * In-memory repositories over `MockStore`.
 *
 * Every method awaits the same fixed latency before touching the store, so screens exercise their
 * real loading states rather than resolving synchronously and hiding a missing spinner.
 */
export function createMockRepositories(options: MockRepositoriesOptions = {}): MockRepositories {
    const scenario = resolveScenario(options.scenario ?? DEFAULT_MOCK_SCENARIO);
    const latency = options.latencyMs ?? DEFAULT_MOCK_LATENCY_MS;
    const tokenStore = options.tokenStore ?? createMemoryTokenStore();
    const store = new MockStore({
        scenario,
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.contexts === undefined ? {} : { contexts: options.contexts }),
    });

    const settle = () => sleep(latency);
    const current = () => store.requireAccount(tokenStore.get());

    /**
     * The eight Prompt 2 repositories, over their own store.
     *
     * They share the foundation bundle's latency so a screen sees one consistent timing model, and
     * they are built here rather than in the registry so that everything behind the mock dynamic
     * import stays behind it.
     */
    const prototype = createPrototypeRepositories({ scenario: scenario.name, settle });

    const auth: AuthRepository = {
        async login(request: LoginRequest): Promise<LoginResult> {
            await settle();
            const outcome = store.login(request.email, request.password);
            if (outcome.kind === 'two_factor') {
                return {
                    status: 'two_factor_required',
                    challengeId: outcome.challengeId,
                    recoveryCodesAvailable: true,
                };
            }
            tokenStore.set(outcome.session.token);
            return { status: 'authenticated', session: outcome.session };
        },

        async register(request: RegisterRequest): Promise<RegisterResult> {
            await settle();
            const session = store.register({
                name: request.name,
                email: request.email,
                password: request.password,
                passwordConfirmation: request.passwordConfirmation,
                acceptTerms: request.acceptTerms,
                acceptPrivacy: request.acceptPrivacy,
            });
            tokenStore.set(session.token);
            return { session, emailVerified: false };
        },

        async logout(): Promise<void> {
            await settle();
            store.logout(tokenStore.get());
            tokenStore.clear();
        },

        async requestPasswordReset(request: { readonly email: string }): Promise<void> {
            await settle();
            store.requestPasswordReset(request.email);
        },

        async resetPassword(request: PasswordResetRequest): Promise<void> {
            await settle();
            store.resetPassword({
                token: request.token,
                email: request.email,
                password: request.password,
                passwordConfirmation: request.passwordConfirmation,
            });
        },

        async verifyEmailStatus(): Promise<EmailVerificationStatus> {
            await settle();
            const user = store.verificationStatus(current());
            return {
                email: user.email,
                verified: user.emailVerifiedAt !== null,
                verifiedAt: user.emailVerifiedAt,
            };
        },

        async resendVerification(): Promise<ResendVerificationResult> {
            await settle();
            return { cooldownSeconds: store.requestVerification(current()) };
        },

        async confirmPassword(request: {
            readonly password: string;
        }): Promise<PasswordConfirmationResult> {
            await settle();
            return { confirmedUntil: store.confirmPassword(current(), request.password) };
        },

        async enableTwoFactor(): Promise<TwoFactorSetup> {
            await settle();
            return store.enableTwoFactor(current());
        },

        async confirmTwoFactor(request: { readonly code: string }): Promise<void> {
            await settle();
            store.confirmTwoFactor(current(), request.code);
        },

        async challengeTwoFactor(request: TwoFactorChallengeRequest): Promise<AuthSession> {
            await settle();
            const session = store.completeTwoFactorChallenge(
                request.challengeId,
                request.code,
                request.recovery === true,
            );
            tokenStore.set(session.token);
            return session;
        },
    };

    const session: SessionRepository = {
        async me(): Promise<MeResponse> {
            await settle();
            return store.me(current());
        },
    };

    const context: ContextRepository = {
        async setContext(request: SetContextRequest): Promise<ActiveContext> {
            await settle();
            return store.setContext(current(), request.organisationId, request.branchId ?? null);
        },
    };

    const devices: DeviceRepository = {
        async list(): Promise<readonly Device[]> {
            await settle();
            return store.devices(current());
        },

        async revoke(deviceId: DeviceId): Promise<void> {
            await settle();
            const account = current();
            store.requireStepUp(account);
            store.revokeDevice(account, deviceId);
        },
    };

    return {
        kind: 'mock',
        scenario,
        tokenStore,
        prototypeStore: prototype.store,
        auth,
        session,
        context,
        devices,
        marketplace: prototype.marketplace,
        nutrition: prototype.nutrition,
        planner: prototype.planner,
        foods: prototype.foods,
        virtualDietitian: prototype.virtualDietitian,
        commerce: prototype.commerce,
        business: prototype.business,
        professional: prototype.professional,
    };
}
