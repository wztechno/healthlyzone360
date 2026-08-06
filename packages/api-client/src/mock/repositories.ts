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
import { createAccountMockRepositories } from './account/repositories.ts';
import type { AccountMockStore } from './account/store.ts';
import { createB2bMockRepositories } from './b2b-application/repositories.ts';
import type { B2bMockStore } from './b2b-application/store.ts';
import type { GuestTokenStore } from '../session/guest-token-store.ts';
import { createGuestTokenStore } from '../session/guest-token-store.ts';
import { createGuestMockRepositories } from './guest/repositories.ts';
import type { GuestMockStore } from './guest/store.ts';
import { createKitchenOpsMockRepositories } from './kitchen-ops/repositories.ts';
import { createKitchenOrdersMockRepositories } from './kitchen-orders/repositories.ts';
import type { KitchenOrdersMockStore } from './kitchen-orders/store.ts';
import { createInvitationsMockRepositories } from './invitations/repositories.ts';
import { createPlatformAdminMockRepositories } from './platform-admin/repositories.ts';
import type { PlatformAdminMockStore } from './platform-admin/store.ts';
import type { KitchenOpsMockStore } from './kitchen-ops/store.ts';
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
    /** The application's guest credential store; a fresh platform one when nobody supplies it. */
    readonly guestTokenStore?: GuestTokenStore | undefined;
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

    /* ── the three journey worlds' mutable stores ────────────────────────────────────────────────
     *
     * `verification`, `account`, `guest` and `b2bApplication` are **not** listed here any more:
     * they are required members of `Repositories` since the integrator wave, so declaring them
     * again would be repeating what the base interface already says. What remains are the stores
     * and the guest credential — the same "exposed for tests, never for screens" arrangement
     * `prototypeStore` has.
     */
    readonly accountStore: AccountMockStore;
    readonly guestStore: GuestMockStore;
    /**
     * The guest credential's store.
     *
     * Still on the bundle rather than in `Repositories`, because it is a *credential store* and not
     * a data surface — the same reason `tokenStore` sits beside the contracts rather than inside
     * them. The application supplies it (`MockRepositoriesOptions.guestTokenStore`) so that the one
     * a hook reads through `useSyncExternalStore` is the one the repository writes to.
     */
    readonly guestTokenStore: GuestTokenStore;
    readonly b2bApplicationStore: B2bMockStore;
    /**
     * The O1–O4 kitchen ops world's mutable store.
     *
     * A sibling of `prototypeStore` on the same terms: self-contained (see `./kitchen-ops/store.ts`'s
     * header for why it does not read the prototype catalogue), exposed only so a test can assert
     * what a mutation did without going back through a repository.
     */
    readonly kitchenOpsStore: KitchenOpsMockStore;

    /**
     * The kitchen orders world's mutable store.
     *
     * A sibling of `kitchenOpsStore` on the same terms, and exposed for one reason the others do
     * not have: the three lifecycle actions are lock-versioned, so a test asserting that a stale
     * write conflicts has to be able to read the version the store now holds without going back
     * through the repository it is testing.
     */
    readonly kitchenOrdersStore: KitchenOrdersMockStore;

    /**
     * The PA1 platform-console world.
     *
     * A sibling of `kitchenOpsStore` on the same terms, and self-contained for a sharper reason
     * than that one: its kitchens are *other people's tenants*, so reusing the session fixture
     * world's Verdant would make one identifier mean both "the organisation I am signed into" and
     * "a row in my console". Exposed only so a test can assert what a suspension did without going
     * back through the repository.
     */
    readonly platformAdminStore: PlatformAdminMockStore;
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
/**
 * How many one-off orders are still in flight.
 *
 * `PrototypeStore` indexes placed orders by their quotable reference and publishes no list, so this
 * counts the states that mean "somebody is still expecting food". A closure or a wind-down that
 * ignored them would be closing over a delivery already on a van.
 */
function openOrderCount(store: PrototypeStore): number {
    return store
        .orders()
        .filter((order) => order.state !== 'delivered' && order.state !== 'cancelled').length;
}

/**
 * How many organisations the signed-in person is an **active** member of.
 *
 * Active only, and that is the whole check: a `pending` invitation is not a seat somebody holds, and
 * counting it would block a closure on an organisation the person has never joined. It is the same
 * predicate `MockStore` applies when it decides whether to resolve an active context at all, which
 * is what makes "you are in the way of your own closure" and "you can switch into this workspace"
 * the same statement.
 *
 * **Signed out answers zero rather than throwing.** `requireAccount` rejects an absent or revoked
 * token, and a blocker registry is not the place to discover that: the closure wizard lives behind
 * the session guard and can only be reached signed in, so the guard is the honest answer here — no
 * signed-in person, no memberships of theirs to be in the way. A port that threw would turn a
 * missing session into an unhandled rejection inside a preconditions read.
 */
function activeMembershipCount(store: MockStore, token: string | null): number {
    try {
        return store
            .requireAccount(token)
            .memberships.filter((membership) => membership.status === 'active').length;
    } catch {
        return 0;
    }
}

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
     * The B1 B2B world, on the same terms as the account world.
     *
     * Not scenario-dependent either: which fixture an applicant holds is a property of how far
     * *they* have got, not of which demo account signed in, and a test that needs a different state
     * builds its own world with `createB2bMockRepositories({ fixture })` or drives this one through
     * `b2bApplicationStore`.
     *
     * **Built before the account world**, which is a change from the order these two were first
     * written in. The J2 blocker registry reads this world for pending signatures, and while a lazy
     * port would have been evaluated late enough to work either way, a closure port that referred
     * upward to a `const` declared below it is a temporal-dead-zone bug waiting for the first person
     * who calls the registry during construction. Declaring the dependency first makes the direction
     * of the arrow visible.
     */
    const b2bWorld = createB2bMockRepositories({
        latencyMs: latency,
        // The settlement registry's one real check. Unbound it answers zero; bound to the prototype
        // world it reads the orders this world actually holds, which is what makes "re-run the
        // checks" a question with an answer rather than a button that always says yes.
        openOrders: () => openOrderCount(prototype.store),
    });

    /**
     * The J1 account world, built here for the same reason the prototype world is: everything
     * behind the mock dynamic import stays behind it.
     *
     * It takes the bundle's latency so a screen sees one timing model, and it is **not** scenario-
     * dependent — `AccountMockStore` seeds the same partway-through-setup person in every world,
     * because the account area's states are a function of what has been done, not of which demo
     * account signed in.
     */
    const accountWorld = createAccountMockRepositories({
        latencyMs: latency,
        /**
         * What the closure blocker registry may read.
         *
         * A **port**, exactly like the guest world's basket port below, and for the same reason:
         * the account world must not import the prototype store, and a J2 blocker that could only
         * be exercised by building the whole universe would be a blocker nobody tests. Bound here,
         * the seeded subscription makes `active_subscriptions` genuinely blocking and a cancelled
         * one makes `unsettled_credit_memos` genuinely advisory — both derived from the store,
         * neither fabricated.
         *
         * **All six are bound now**, including the two that were not. The note that stood here said
         * `organisation_memberships` and `pending_b2b_signatures` were left unbound because this
         * world's memberships live in the foundation `MockStore` "under a different identity
         * model" — and that caution was right about the identities and wrong about the remedy.
         * `not_applicable` is the registry's word for *nobody asked*, and it was being used to mean
         * *we asked and the answer is awkward*, which is the one thing that vocabulary must never
         * be spent on: two of the seven checks were permanently reporting that a module does not
         * exist, when both modules are right here.
         *
         * The identity caveat is real and is now stated where it belongs rather than used as a
         * reason not to look. Three fixed people live in this bundle — the scenario's signed-in user
         * (Layla Haddad under the default `multi-org-dietitian`), the account world's own seed
         * (always Nour Saleh), and the B2B applicant (Northwind's procurement address) — and no
         * fixture reconciles them. So each port answers the question *its own* world can answer
         * truthfully: memberships are the **signed-in** person's, signatures are **this
         * applicant's**. Both are facts about the world the wizard is running in, which is more than
         * `not_applicable` was ever saying, and neither is a fabricated `clear`.
         *
         * The payoff is that both paths are now reachable from a seeded world instead of only from a
         * hand-built test double: the default dietitian scenario has two active memberships and
         * blocks, every consumer scenario has none and clears, and the `agreement-pending` B2B
         * fixture blocks on a signature the default `draft-half-complete` one does not have.
         */
        closureWorld: {
            openOrders: () => openOrderCount(prototype.store),
            liveSubscriptions: () =>
                prototype.store
                    .subscriptions()
                    .filter(
                        (subscription) =>
                            subscription.state === 'active' ||
                            subscription.state === 'paused' ||
                            subscription.state === 'skipped_today',
                    ).length,
            upcomingDeliveries: () =>
                prototype.store
                    .subscriptions()
                    .filter((subscription) => subscription.nextDeliveryDate !== null).length,
            unsettledCreditMemos: () =>
                prototype.store.creditMemos().filter((memo) => memo.status === 'recorded').length,
            // The signed-in person's active seats — see the note above on whose they are.
            organisationMemberships: () => activeMembershipCount(store, tokenStore.get()),
            /**
             * An agreement waiting for this applicant's signature.
             *
             * `application()` rather than `agreement(id)`: the latter throws `resource.not_found`
             * for a world with no application, and a blocker registry must not raise. This store
             * holds at most one application and one agreement, so the count is `0` or `1` by
             * construction rather than by a rule somebody has to maintain.
             *
             * It tracks the wizard live — signing moves the agreement out of `pending_signature`,
             * which clears the blocker in the same breath, so a person who signs and then closes
             * their account is not told to go back and sign.
             */
            pendingB2bSignatures: () =>
                b2bWorld.store.application()?.agreement?.status === 'pending_signature' ? 1 : 0,
        },
        /**
         * Closing the account signs the person out, in the same breath.
         *
         * The account world does not own the session and must not: it has no token store and no
         * server session. This callback is how it tells the bundle, so that "your account is
         * closed" and "you are signed out" are one event rather than a screen discovering the
         * second one on its next request.
         */
        onAccountClosed: () => {
            const token = tokenStore.get();
            if (token !== null) store.logout(token);
            tokenStore.clear();
        },
    });

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
    const guestTokenStore = options.guestTokenStore ?? createGuestTokenStore();
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

    /**
     * The O1–O4 kitchen ops world.
     *
     * Built here rather than inside `createPrototypeRepositories`, on purpose: it is a *sibling* of
     * the K1 catalogue (`kitchenAdmin`), not a branch of it — see `../contracts/kitchen-ops.ts`'s
     * header — and its own store is deliberately self-contained (see `./kitchen-ops/store.ts`'s
     * header), so composing it here keeps that independence visible rather than folding it into the
     * one store the K1 catalogue already shares with eleven other domains.
     */
    const kitchenOpsWorld = createKitchenOpsMockRepositories({ settle });

    /**
     * The kitchen orders world.
     *
     * Built here for the same reason `kitchenOpsWorld` is, and self-contained for a sharper one:
     * its rows are the *seller's* copy of orders the prototype commerce world also models from the
     * buyer's side. Sharing one array would make a customer's receipt and a kitchen's ticket the
     * same object, which is exactly the conflation `../contracts/kitchen-orders.ts`'s header exists
     * to prevent.
     */
    const kitchenOrdersWorld = createKitchenOrdersMockRepositories({ settle });
    const platformAdminWorld = createPlatformAdminMockRepositories({ settle });

    /*
     * The PA1 invitation world.
     *
     * `invitedEmail` is the scenario's own primary address, so the fixture link is addressed to
     * whoever the switcher says to sign in as and the happy path works out of the box.
     * `currentEmail` is read *per call* rather than captured: a tester signing out and back in as a
     * different persona is exactly the mismatch state this world exists to make reachable, and a
     * captured address would freeze the answer at construction time.
     *
     * It returns `null` rather than throwing when nobody is signed in — the read is anonymous, so
     * "there is no session" is an ordinary condition on this surface rather than a failure.
     */
    const invitationsWorld = createInvitationsMockRepositories({
        settle,
        invitedEmail: scenario.primaryEmail,
        currentEmail: () => {
            try {
                return current().user.email;
            } catch {
                return null;
            }
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
        guest: guestWorld.guest,
        guestStore: guestWorld.store,
        guestTokenStore,
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
        kitchenOps: kitchenOpsWorld.kitchenOps,
        kitchenOpsStore: kitchenOpsWorld.store,
        kitchenOrders: kitchenOrdersWorld.kitchenOrders,
        kitchenOrdersStore: kitchenOrdersWorld.store,
        invitations: invitationsWorld.invitations,
        platformAdmin: platformAdminWorld.platformAdmin,
        platformAdminStore: platformAdminWorld.store,
    };
}
