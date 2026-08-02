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
import type { AccountRepository } from '../contracts/account.ts';
import type { Repositories } from '../contracts/index.ts';
import type {
    OtpChallenge,
    OtpChannel,
    VerificationRepository,
} from '../contracts/verification.ts';
import { createAccountMockRepositories } from './account/repositories.ts';
import type { AccountMockStore } from './account/store.ts';
import type { B2BApplicationRepository } from '../contracts/b2b-application.ts';
import { createB2bMockRepositories } from './b2b-application/repositories.ts';
import type { B2bMockStore } from './b2b-application/store.ts';
import type { GuestRepository } from '../contracts/guest.ts';
import type { GuestTokenStore } from '../session/guest-token-store.ts';
import { createGuestTokenStore } from '../session/guest-token-store.ts';
import { createGuestMockRepositories } from './guest/repositories.ts';
import type { GuestMockStore } from './guest/store.ts';
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

    /* ── J1: the account world, carried ahead of its registration ───────────────────────────────
     *
     * `VerificationRepository` and `AccountRepository` are not members of the required
     * `Repositories` bundle yet (`../contracts/index.ts` says why: registering them is the same
     * commit that writes the API-side stub, and this is not that commit). Until then the mock
     * bundle carries them as **extra** fields.
     *
     * That is what lets the account screens work in mock mode without importing the mock world:
     * the application's own ESLint guard forbids a screen or a hook from reaching into
     * `@healthy360/api-client/mock` at all (plan §5), and it is right to. The alternative — an
     * exemption for one shim file — would open the door the guard exists to keep shut.
     *
     * A consumer discovers these with a runtime `typeof` test rather than a cast, so the day they
     * become required members of `Repositories` nothing at the call site changes.
     */
    readonly verification: VerificationRepository;
    readonly account: AccountRepository;
    /** The account world's own mutable store, on the same terms as `prototypeStore`. */
    readonly accountStore: AccountMockStore;
    /**
     * The closed list of areas a delivery address may point at.
     *
     * **A contract gap, carried explicitly rather than disguised.** `CustomerAddress.areaId` is a
     * foreign key and the store refuses an area it does not know, so an address editor needs the
     * list — and no consumer-facing contract operation publishes one.
     * `KitchenAdminRepository.listServiceAreas` exists but is an organisation-scoped management
     * surface a consumer has neither the context nor the permission for.
     *
     * It is a bare function rather than a repository method precisely so it cannot be mistaken for
     * part of a contract. It disappears when `AccountRepository` gains `listServiceAreas()`, or
     * when a public `GET /api/v1/reference/service-areas` exists.
     */
    readonly accountServiceAreas: () => Promise<
        readonly { readonly id: string; readonly name: string }[]
    >;

    /* ── G1: the guest world, carried on the same terms ──────────────────────────────────────────
     *
     * `GuestRepository` is not in the required `Repositories` bundle yet, for the reason above, so
     * the mock bundle carries it as extra fields and the application discovers them with a runtime
     * `typeof` test rather than a cast (`features/guest/repositories-shim.ts`).
     *
     * `guestTokenStore` is exposed because the guest credential outlives no single screen: signing
     * in, converting and requesting deletion all end the guest identity, and each of those happens
     * somewhere that is not the checkout. `getGuestChallenge` and `resendGuestChallenge` are bare
     * functions rather than repository methods — `GuestRepository` deliberately does not grow a
     * second copy of the OTP surface — so they cannot be mistaken for part of a contract.
     */
    readonly guest: GuestRepository;
    readonly guestStore: GuestMockStore;
    readonly guestTokenStore: GuestTokenStore;
    readonly getGuestChallenge: (challengeId: string) => Promise<OtpChallenge>;
    readonly resendGuestChallenge: (
        challengeId: string,
        channel?: OtpChannel,
    ) => Promise<OtpChallenge>;

    /* ── B1: the B2B onboarding world, carried on the same terms ────────────────────────────────
     *
     * `B2BApplicationRepository` is not a member of the required `Repositories` bundle either, for
     * exactly the reason the ones above are not. The B2B screens resolve it with the same runtime
     * `typeof` probe (`features/b2b-application/repositories-shim.ts`), so the day it becomes a
     * required member nothing at any call site changes — the shim is deleted and the import moves.
     */
    readonly b2bApplication: B2BApplicationRepository;
    /** The B2B world's own mutable store, on the same terms as `prototypeStore`. */
    readonly b2bApplicationStore: B2bMockStore;
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

    /**
     * The J1 account world, built here for the same reason the prototype world is: everything
     * behind the mock dynamic import stays behind it.
     *
     * It takes the bundle's latency so a screen sees one timing model, and it is **not** scenario-
     * dependent — `AccountMockStore` seeds the same partway-through-setup person in every world,
     * because the account area's states are a function of what has been done, not of which demo
     * account signed in.
     */
    const accountWorld = createAccountMockRepositories({ latencyMs: latency });

    /**
     * The B1 B2B world, on the same terms as the account world.
     *
     * Not scenario-dependent either: which fixture an applicant holds is a property of how far
     * *they* have got, not of which demo account signed in, and a test that needs a different state
     * builds its own world with `createB2bMockRepositories({ fixture })` or drives this one through
     * `b2bApplicationStore`.
     */
    const b2bWorld = createB2bMockRepositories({ latencyMs: latency });

    /**
     * The G1 guest world, wired to the prototype basket.
     *
     * The basket is reached through a **port** rather than a direct reference, so the guest world
     * stays usable on its own (its `createFallbackCartPort` is what its unit tests use) while the
     * bundle gives it the real one — which is what makes "place the order and empty the basket" a
     * single honest step over the same cart the catalogue screens filled.
     *
     * The token store is the platform one, so on the web a guest credential lands in
     * `sessionStorage` and dies with the tab. In Node and Jest there is no `sessionStorage` and it
     * degrades to memory, which is the correct behaviour for both.
     */
    const guestTokenStore = createGuestTokenStore();
    const guestWorld = createGuestMockRepositories({
        latencyMs: latency,
        tokenStore: guestTokenStore,
        cart: {
            read: () => prototype.store.cart(),
            price: (cartId) => prototype.store.previewCheckout({ cartId }),
            clear: (cartId) => {
                // `PrototypeStore` has no `clearCart`, and adding one would be an edit to a store
                // this wave does not own. Removing the lines one at a time reaches the same state
                // through the operation the contract already publishes.
                for (const item of prototype.store.cart().items) {
                    prototype.store.removeCartItem(cartId, item.id);
                }
            },
        },
    });

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
        verification: accountWorld.verification,
        account: accountWorld.account,
        accountStore: accountWorld.store,
        accountServiceAreas: () => Promise.resolve(accountWorld.store.serviceAreas()),
        guest: guestWorld.guest,
        guestStore: guestWorld.store,
        guestTokenStore,
        getGuestChallenge: guestWorld.getGuestChallenge,
        resendGuestChallenge: guestWorld.resendGuestChallenge,
        b2bApplication: b2bWorld.b2bApplication,
        b2bApplicationStore: b2bWorld.store,
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
        kitchenAdmin: prototype.kitchenAdmin,
    };
}
