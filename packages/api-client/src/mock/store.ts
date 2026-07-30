import { UserId } from '@healthy360/domain-types';
import type {
    ActiveContext,
    BranchId,
    Device,
    DeviceId,
    Membership,
    OrganisationId,
    SessionUser,
} from '@healthy360/domain-types';

import type { AuthSession, TwoFactorSetup } from '../contracts/auth.ts';
import {
    apiFailure,
    rateLimitFailure,
    throwFailure,
    validationFailure,
} from '../contracts/failure.ts';
import type { MeResponse, PendingConsent } from '../contracts/session.ts';
import {
    MOCK_GLOBAL_PERMISSIONS,
    MOCK_NOW,
    entitlementsForOrganisation,
    makeMockUser,
    permissionsForMembership,
} from './fixtures.ts';
import type { MockAccount, MockScenario } from './scenarios.ts';

/** How long one password confirmation keeps a step-up gate open. */
export const STEP_UP_WINDOW_SECONDS = 300;
/** Minimum gap between two verification emails. */
export const RESEND_COOLDOWN_SECONDS = 60;
/** Failed sign-in attempts, per email address, before the mock starts rate-limiting. */
export const LOGIN_ATTEMPT_LIMIT = 5;
export const LOGIN_RATE_LIMIT_RETRY_AFTER_SECONDS = 30;

/** The one TOTP code the mock authenticator produces, and its single recovery code. */
export const MOCK_TOTP_CODE = '123456';
export const MOCK_RECOVERY_CODE = 'HL360-RECOVERY-1';
export const MOCK_TWO_FACTOR_SECRET = 'JBSWY3DPEHPK3PXP';

export type Clock = () => number;

/**
 * Where the mock "server" keeps each user's last-applied context between page loads.
 *
 * The real backend persists the last-used context server-side (`user_profiles.last_organisation_id`,
 * Phase 4), so a page reload does not lose it. A mock world that forgets context on reload would
 * misrepresent that behaviour — deep-linking a workspace route after a reload would bounce to the
 * organisation picker when the real application would not.
 */
export interface ContextPersistence {
    load(): Readonly<Record<string, ActiveContext>> | null;
    save(contexts: Readonly<Record<string, ActiveContext>>): void;
}

export interface MockStoreOptions {
    readonly scenario: MockScenario;
    readonly now?: Clock | undefined;
    readonly contexts?: ContextPersistence | undefined;
}

interface MutableAccount {
    user: SessionUser;
    password: string;
    memberships: Membership[];
    devices: Device[];
    pendingConsents: PendingConsent[];
}

function cloneAccount(account: MockAccount): MutableAccount {
    return {
        user: account.user,
        password: account.password,
        memberships: [...account.memberships],
        devices: [...account.devices],
        pendingConsents: [...account.pendingConsents],
    };
}

const TOKEN_PREFIX = 'mock-session.';

/** Deterministic: the same user always gets the same token, so a reload restores the session. */
function tokenFor(userId: string): string {
    return `${TOKEN_PREFIX}${userId}`;
}

function challengeFor(userId: string): string {
    return `mock-2fa.${userId}`;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The mutable world behind `MockRepositories`.
 *
 * It is deliberately a plain class with no I/O: every method is synchronous and total, so the
 * repository layer above it only has to add latency and the shape of the public contract. All
 * rejections go through `throwFailure`, which means the mock and the future API repository are
 * indistinguishable to a screen.
 */
export class MockStore {
    readonly scenario: MockScenario;

    readonly #now: Clock;
    readonly #accountsByEmail = new Map<string, MutableAccount>();
    readonly #accountsById = new Map<string, MutableAccount>();
    readonly #sessions = new Map<string, string>();
    readonly #revokedTokens = new Set<string>();
    readonly #contexts = new Map<string, ActiveContext>();
    readonly #failedLogins = new Map<string, number>();
    readonly #stepUpUntil = new Map<string, number>();
    readonly #lastResendAt = new Map<string, number>();
    readonly #verificationRequested = new Set<string>();
    readonly #twoFactorChallenges = new Map<string, string>();
    readonly #twoFactorSetups = new Map<string, TwoFactorSetup>();

    #permissionVersion = 1;
    #registrations = 0;

    readonly #contextPersistence: ContextPersistence | null;

    constructor(options: MockStoreOptions) {
        this.scenario = options.scenario;
        this.#now = options.now ?? (() => Date.now());
        this.#contextPersistence = options.contexts ?? null;
        for (const account of options.scenario.accounts) this.#add(cloneAccount(account));

        const persisted = this.#contextPersistence?.load() ?? null;
        if (persisted !== null) {
            for (const [userId, context] of Object.entries(persisted)) {
                // Only restore contexts for users that exist in this scenario's world.
                if (this.#accountsById.has(userId)) {
                    this.#contexts.set(userId, context);
                    this.#permissionVersion = Math.max(
                        this.#permissionVersion,
                        context.permissionVersion,
                    );
                }
            }
        }
    }

    #persistContexts(): void {
        this.#contextPersistence?.save(Object.fromEntries(this.#contexts));
    }

    #add(account: MutableAccount): void {
        this.#accountsByEmail.set(account.user.email.toLowerCase(), account);
        this.#accountsById.set(account.user.id, account);
    }

    // ── sessions ────────────────────────────────────────────────────────────────────────────────

    /**
     * The account behind a token, or a rejection. Every authenticated call starts here.
     *
     * A token issued *before* this store existed is adopted rather than refused, because that is
     * precisely what a page reload looks like: the browser kept the token, the in-memory world did
     * not. Tokens explicitly revoked by `logout` within this store's lifetime stay dead, and the
     * application clears the persisted token on sign-out so a reload cannot resurrect one.
     */
    requireAccount(token: string | null): MutableAccount {
        if (token === null || token.length === 0) throwFailure(apiFailure('auth.unauthenticated'));
        if (this.#revokedTokens.has(token)) throwFailure(apiFailure('auth.unauthenticated'));

        let userId = this.#sessions.get(token);
        if (userId === undefined && token.startsWith(TOKEN_PREFIX)) {
            const candidate = token.slice(TOKEN_PREFIX.length);
            if (this.#accountsById.has(candidate)) {
                this.#sessions.set(token, candidate);
                userId = candidate;
            }
        }
        if (userId === undefined) throwFailure(apiFailure('auth.unauthenticated'));

        const account = this.#accountsById.get(userId);
        if (account === undefined) throwFailure(apiFailure('auth.unauthenticated'));
        return account;
    }

    #issueSession(account: MutableAccount): AuthSession {
        const token = tokenFor(account.user.id);
        this.#revokedTokens.delete(token);
        this.#sessions.set(token, account.user.id);
        this.#failedLogins.delete(account.user.email.toLowerCase());
        return { token, userId: account.user.id, expiresAt: null };
    }

    // ── authentication ──────────────────────────────────────────────────────────────────────────

    login(email: string, password: string):
        | { readonly kind: 'session'; readonly session: AuthSession }
        | { readonly kind: 'two_factor'; readonly challengeId: string } {
        const normalised = email.trim().toLowerCase();

        if (normalised.length === 0 || !EMAIL_SHAPE.test(normalised)) {
            throwFailure(
                validationFailure({ email: ['Enter a valid email address.'] }, {
                    correlationId: this.#correlationId('login'),
                }),
            );
        }

        const attempts = this.#failedLogins.get(normalised) ?? 0;
        if (attempts >= LOGIN_ATTEMPT_LIMIT) {
            throwFailure(
                rateLimitFailure(LOGIN_RATE_LIMIT_RETRY_AFTER_SECONDS, {
                    correlationId: this.#correlationId('login'),
                }),
            );
        }

        const account = this.#accountsByEmail.get(normalised);
        if (account === undefined || account.password !== password) {
            this.#failedLogins.set(normalised, attempts + 1);
            throwFailure(
                apiFailure('auth.invalid_credentials', {
                    correlationId: this.#correlationId('login'),
                }),
            );
        }

        if (account.user.twoFactorEnabled) {
            const challengeId = challengeFor(account.user.id);
            this.#twoFactorChallenges.set(challengeId, account.user.id);
            return { kind: 'two_factor', challengeId };
        }

        return { kind: 'session', session: this.#issueSession(account) };
    }

    completeTwoFactorChallenge(challengeId: string, code: string, recovery: boolean): AuthSession {
        const userId = this.#twoFactorChallenges.get(challengeId);
        if (userId === undefined) {
            throwFailure(apiFailure('auth.invalid_credentials'));
        }
        const account = this.#accountsById.get(userId);
        if (account === undefined) throwFailure(apiFailure('auth.invalid_credentials'));

        const expected = recovery ? MOCK_RECOVERY_CODE : MOCK_TOTP_CODE;
        if (code.trim() !== expected) {
            throwFailure(
                validationFailure({ code: ['That code is not correct. Try the next one.'] }),
            );
        }

        this.#twoFactorChallenges.delete(challengeId);
        return this.#issueSession(account);
    }

    register(input: {
        readonly name: string;
        readonly email: string;
        readonly password: string;
        readonly passwordConfirmation: string;
        readonly acceptTerms: boolean;
        readonly acceptPrivacy: boolean;
    }): AuthSession {
        const email = input.email.trim().toLowerCase();
        const fields: Record<string, readonly string[]> = {};

        if (!EMAIL_SHAPE.test(email)) fields['email'] = ['Enter a valid email address.'];
        else if (this.#accountsByEmail.has(email)) {
            fields['email'] = ['That email address is already registered.'];
        }
        if (input.password !== input.passwordConfirmation) {
            fields['password_confirmation'] = ['The two passwords do not match.'];
        }
        if (!input.acceptTerms) fields['accept_terms'] = ['You must accept the terms of service.'];
        if (!input.acceptPrivacy) {
            fields['accept_privacy'] = ['You must accept the privacy notice.'];
        }
        if (Object.keys(fields).length > 0) {
            throwFailure(
                validationFailure(fields, { correlationId: this.#correlationId('register') }),
            );
        }

        this.#registrations += 1;
        // 10 fixed digits + a 2-digit counter keeps the final UUID group at exactly 12 characters.
        const suffix = String(this.#registrations).padStart(2, '0');
        const [given = input.name, ...rest] = input.name.trim().split(/\s+/);
        const user = makeMockUser({
            id: UserId.unsafe(`01935f6c-0000-7000-8000-0000000009${suffix}`),
            email,
            displayName: input.name.trim(),
            givenName: given,
            familyName: rest.join(' '),
            verified: false,
        });

        const account: MutableAccount = {
            user,
            password: input.password,
            memberships: [],
            devices: [],
            pendingConsents: [],
        };
        this.#add(account);
        return this.#issueSession(account);
    }

    logout(token: string | null): void {
        if (token === null) return;
        const userId = this.#sessions.get(token);
        this.#sessions.delete(token);
        this.#revokedTokens.add(token);
        if (userId !== undefined) {
            this.#contexts.delete(userId);
            this.#stepUpUntil.delete(userId);
        }
    }

    /**
     * The mock cannot receive a click in an inbox, so it simulates one: a verification email having
     * been *requested* is treated as the link having been opened by the time the client next asks.
     * That keeps the "resend → I have confirmed it" journey testable without a mail server.
     */
    verificationStatus(account: MutableAccount): SessionUser {
        if (account.user.emailVerifiedAt === null && this.#verificationRequested.has(account.user.id)) {
            account.user = { ...account.user, emailVerifiedAt: MOCK_NOW };
            this.#verificationRequested.delete(account.user.id);
        }
        return account.user;
    }

    requestVerification(account: MutableAccount): number {
        const last = this.#lastResendAt.get(account.user.id);
        const now = this.#now();
        if (last !== undefined) {
            const elapsed = Math.floor((now - last) / 1000);
            if (elapsed < RESEND_COOLDOWN_SECONDS) {
                throwFailure(rateLimitFailure(RESEND_COOLDOWN_SECONDS - elapsed));
            }
        }
        this.#lastResendAt.set(account.user.id, now);
        this.#verificationRequested.add(account.user.id);
        return RESEND_COOLDOWN_SECONDS;
    }

    requestPasswordReset(email: string): void {
        // Deliberately silent about whether the address exists (account-enumeration).
        if (!EMAIL_SHAPE.test(email.trim().toLowerCase())) {
            throwFailure(validationFailure({ email: ['Enter a valid email address.'] }));
        }
    }

    resetPassword(input: {
        readonly token: string;
        readonly email: string;
        readonly password: string;
        readonly passwordConfirmation: string;
    }): void {
        const fields: Record<string, readonly string[]> = {};
        if (input.token !== MOCK_PASSWORD_RESET_TOKEN) {
            fields['token'] = ['This reset link has expired. Request a new one.'];
        }
        if (input.password !== input.passwordConfirmation) {
            fields['password_confirmation'] = ['The two passwords do not match.'];
        }
        if (Object.keys(fields).length > 0) throwFailure(validationFailure(fields));

        const account = this.#accountsByEmail.get(input.email.trim().toLowerCase());
        if (account !== undefined) account.password = input.password;
    }

    confirmPassword(account: MutableAccount, password: string): string {
        if (password !== account.password) {
            throwFailure(validationFailure({ password: ['That password is not correct.'] }));
        }
        const until = this.#now() + STEP_UP_WINDOW_SECONDS * 1000;
        this.#stepUpUntil.set(account.user.id, until);
        return new Date(until).toISOString();
    }

    requireStepUp(account: MutableAccount): void {
        const until = this.#stepUpUntil.get(account.user.id);
        if (until === undefined || until <= this.#now()) {
            throwFailure(apiFailure('auth.step_up_required'));
        }
    }

    enableTwoFactor(account: MutableAccount): TwoFactorSetup {
        const setup: TwoFactorSetup = {
            secret: MOCK_TWO_FACTOR_SECRET,
            otpauthUri: `otpauth://totp/Healthy360:${account.user.email}?secret=${MOCK_TWO_FACTOR_SECRET}&issuer=Healthy360`,
            recoveryCodes: [MOCK_RECOVERY_CODE],
        };
        this.#twoFactorSetups.set(account.user.id, setup);
        return setup;
    }

    confirmTwoFactor(account: MutableAccount, code: string): void {
        if (!this.#twoFactorSetups.has(account.user.id)) {
            throwFailure(apiFailure('server', { message: 'Two-factor setup has not been started.' }));
        }
        if (code.trim() !== MOCK_TOTP_CODE) {
            throwFailure(validationFailure({ code: ['That code is not correct.'] }));
        }
        account.user = { ...account.user, twoFactorEnabled: true };
        this.#twoFactorSetups.delete(account.user.id);
    }

    // ── session hydration and context ───────────────────────────────────────────────────────────

    me(account: MutableAccount): MeResponse {
        const user = this.verificationStatus(account);
        return {
            user,
            profile: user.profile,
            memberships: [...account.memberships],
            activeContext: this.#resolveContext(account),
            pendingConsents: [...account.pendingConsents],
        };
    }

    /**
     * A user with no *active* membership has nothing to choose between, so the server hands them a
     * global context immediately (decision D1). A user with memberships gets `null` until they pick.
     */
    #resolveContext(account: MutableAccount): ActiveContext | null {
        const stored = this.#contexts.get(account.user.id);
        if (stored !== undefined) return stored;
        const hasActiveMembership = account.memberships.some(
            (membership) => membership.status === 'active',
        );
        if (hasActiveMembership) return null;
        return this.globalContext();
    }

    globalContext(): ActiveContext {
        return {
            organisationId: null,
            branchId: null,
            membershipId: null,
            permissions: [...MOCK_GLOBAL_PERMISSIONS],
            entitlements: [],
            permissionVersion: this.#permissionVersion,
        };
    }

    setContext(
        account: MutableAccount,
        organisationId: OrganisationId | null | undefined,
        branchId: BranchId | null | undefined,
    ): ActiveContext {
        if (this.verificationStatus(account).emailVerifiedAt === null) {
            throwFailure(apiFailure('auth.email_unverified'));
        }
        if (organisationId === null || organisationId === undefined || organisationId.length === 0) {
            throwFailure(apiFailure('context.organisation_required'));
        }

        const membership = account.memberships.find(
            (candidate) => candidate.organisation.id === organisationId,
        );
        if (membership === undefined || membership.status !== 'active') {
            throwFailure(apiFailure('context.organisation_forbidden'));
        }

        let branch: BranchId | null = null;
        if (branchId !== null && branchId !== undefined && branchId.length > 0) {
            const inScope = membership.branches.some((candidate) => candidate.id === branchId);
            if (!inScope) throwFailure(apiFailure('context.branch_out_of_scope'));
            branch = branchId;
        } else if (membership.branches.length === 1) {
            // Exactly one branch is not a choice — the server applies it (client picker auto-skips).
            branch = membership.branches[0]?.id ?? null;
        }

        this.#permissionVersion += 1;
        const context: ActiveContext = {
            organisationId,
            branchId: branch,
            membershipId: membership.id,
            permissions: permissionsForMembership(membership),
            entitlements: entitlementsForOrganisation(organisationId),
            permissionVersion: this.#permissionVersion,
        };
        this.#contexts.set(account.user.id, context);
        this.#persistContexts();
        return context;
    }

    // ── devices ─────────────────────────────────────────────────────────────────────────────────

    devices(account: MutableAccount): readonly Device[] {
        return [...account.devices];
    }

    revokeDevice(account: MutableAccount, deviceId: DeviceId): void {
        const device = account.devices.find((candidate) => candidate.id === deviceId);
        if (device === undefined) {
            throwFailure(validationFailure({ device: ['That device is no longer listed.'] }));
        }
        if (device.isCurrent) {
            throwFailure(
                validationFailure({ device: ['You cannot revoke the session you are using.'] }),
            );
        }
        account.devices = account.devices.filter((candidate) => candidate.id !== deviceId);
    }

    // ── diagnostics ─────────────────────────────────────────────────────────────────────────────

    /** Stable, human-readable correlation ids so error screens have something to show. */
    #correlationId(operation: string): string {
        return `mock-${this.scenario.name}-${operation}`;
    }
}

/** The only reset token the mock accepts; deep-linked by the e2e reset-password journey. */
export const MOCK_PASSWORD_RESET_TOKEN = 'mock-reset-token';
