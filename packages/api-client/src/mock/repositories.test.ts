import { beforeEach, describe, expect, it } from 'vitest';

import { asApiFailure, createMemoryTokenStore } from '../contracts/index.ts';
import type { ApiFailure, Repositories, SessionTokenStore } from '../contracts/index.ts';
import { MOCK_ORGANISATION_ENTITLEMENTS, MOCK_PASSWORD } from './fixtures.ts';
import { MOCK_BRANCH_IDS, MOCK_DEVICE_IDS, MOCK_ORGANISATION_IDS } from './ids.ts';
import { createMockRepositories } from './repositories.ts';
import type { MockRepositories } from './repositories.ts';
import { MOCK_SCENARIOS, MOCK_SCENARIO_NAMES } from './scenarios.ts';
import type { MockScenarioName } from './scenarios.ts';
import {
    LOGIN_ATTEMPT_LIMIT,
    LOGIN_RATE_LIMIT_RETRY_AFTER_SECONDS,
    MOCK_PASSWORD_RESET_TOKEN,
    MOCK_RECOVERY_CODE,
    MOCK_TOTP_CODE,
    RESEND_COOLDOWN_SECONDS,
} from './store.ts';

/** A clock the tests drive by hand, so cooldowns and step-up windows are not wall-clock dependent. */
function fakeClock(start = 1_800_000_000_000) {
    let current = start;
    return {
        now: () => current,
        advanceSeconds(seconds: number) {
            current += seconds * 1000;
        },
    };
}

function make(
    scenario: MockScenarioName,
    overrides: { readonly tokenStore?: SessionTokenStore; readonly now?: () => number } = {},
): MockRepositories {
    return createMockRepositories({ scenario, latencyMs: 0, ...overrides });
}

/** Runs `operation` and returns the `ApiFailure` it rejected with, failing the test if it resolved. */
async function failureOf(operation: () => Promise<unknown>): Promise<ApiFailure> {
    try {
        await operation();
    } catch (error) {
        const failure = asApiFailure(error);
        if (failure === null) throw error;
        return failure;
    }
    throw new Error('Expected the operation to reject, but it resolved.');
}

async function signIn(
    repositories: Repositories,
    email: string,
    password = MOCK_PASSWORD,
): Promise<void> {
    const result = await repositories.auth.login({ email, password });
    expect(result.status).toBe('authenticated');
}

describe('scenario inventory', () => {
    it('exposes exactly the nine named worlds, each self-labelled', () => {
        expect([...MOCK_SCENARIO_NAMES]).toEqual([
            'multi-org-dietitian',
            'single-org-owner',
            'customer-no-org',
            'unverified-email',
            'two-factor-user',
            'platform-admin',
            // Prompt 2: the same consumer account, before and after onboarding.
            'consumer-prototype',
            'consumer-onboarding',
            // J1: the same person again, partway through setting the account up.
            'consumer-account-setup',
        ]);
        for (const name of MOCK_SCENARIO_NAMES) {
            const scenario = MOCK_SCENARIOS[name];
            expect(scenario.name).toBe(name);
            expect(scenario.summary.length).toBeGreaterThan(0);
            expect(scenario.accounts.length).toBeGreaterThan(0);
            expect(scenario.accounts.some((a) => a.user.email === scenario.primaryEmail)).toBe(
                true,
            );
        }
    });

    it.each(MOCK_SCENARIO_NAMES)(
        '%s signs its primary account in with the demo password',
        async (name) => {
            const repositories = make(name);
            const result = await repositories.auth.login({
                email: MOCK_SCENARIOS[name].primaryEmail,
                password: MOCK_PASSWORD,
            });
            // The two-factor world stops at the challenge; every other world issues a session.
            expect(result.status).toBe(
                name === 'two-factor-user' ? 'two_factor_required' : 'authenticated',
            );
        },
    );

    it.each(MOCK_SCENARIO_NAMES)('%s rejects the wrong password', async (name) => {
        const repositories = make(name);
        const failure = await failureOf(() =>
            repositories.auth.login({
                email: MOCK_SCENARIOS[name].primaryEmail,
                password: 'not-the-password',
            }),
        );
        expect(failure.code).toBe('auth.invalid_credentials');
        expect(failure.retryable).toBe(false);
    });

    it('produces identical identifiers on every construction', async () => {
        const first = make('multi-org-dietitian');
        const second = make('multi-org-dietitian');
        await signIn(first, MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail);
        await signIn(second, MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail);
        expect(await first.session.me()).toEqual(await second.session.me());
    });
});

describe('multi-org-dietitian', () => {
    let repositories: MockRepositories;
    const email = MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail;

    beforeEach(async () => {
        repositories = make('multi-org-dietitian');
        await signIn(repositories, email);
    });

    it('mirrors the backend demo tenants — Cedar Clinic (2 branches) and Verdant Kitchen', async () => {
        const me = await repositories.session.me();
        const active = me.memberships.filter((membership) => membership.status === 'active');

        expect(active.map((membership) => membership.organisation.name)).toEqual([
            'Cedar Clinic',
            'Verdant Kitchen',
        ]);
        expect(active[0]?.branches.map((branch) => branch.name)).toEqual(['Hamra', 'Jounieh']);
        expect(active[1]?.branches.map((branch) => branch.name)).toEqual(['Al Quoz']);
    });

    it('lists a pending invitation alongside the active memberships', async () => {
        const me = await repositories.session.me();
        expect(me.memberships.filter((m) => m.status === 'pending')).toHaveLength(1);
    });

    it('has no active context until one is chosen', async () => {
        expect((await repositories.session.me()).activeContext).toBeNull();
    });

    it('hydrates permissions and entitlements from the chosen organisation', async () => {
        const context = await repositories.context.setContext({
            organisationId: MOCK_ORGANISATION_IDS.cedarClinic,
            branchId: MOCK_BRANCH_IDS.jounieh,
        });

        expect(context.organisationId).toBe(MOCK_ORGANISATION_IDS.cedarClinic);
        expect(context.branchId).toBe(MOCK_BRANCH_IDS.jounieh);
        expect(context.permissions).toContain('organisation.view_current');
        expect(context.permissions).not.toContain('platform.access_admin');
        expect(context.entitlements).toEqual(
            MOCK_ORGANISATION_ENTITLEMENTS[MOCK_ORGANISATION_IDS.cedarClinic],
        );
        expect((await repositories.session.me()).activeContext).toEqual(context);
    });

    it('bumps the permission version on every context change', async () => {
        const first = await repositories.context.setContext({
            organisationId: MOCK_ORGANISATION_IDS.cedarClinic,
        });
        const second = await repositories.context.setContext({
            organisationId: MOCK_ORGANISATION_IDS.verdantKitchen,
        });
        expect(second.permissionVersion).toBeGreaterThan(first.permissionVersion);
        expect(second.permissions).toContain('branch.manage_current');
    });

    it('applies the only branch automatically when a membership has exactly one', async () => {
        const context = await repositories.context.setContext({
            organisationId: MOCK_ORGANISATION_IDS.verdantKitchen,
        });
        expect(context.branchId).toBe(MOCK_BRANCH_IDS.alQuoz);
    });

    it('leaves the branch unset when the membership spans several', async () => {
        const context = await repositories.context.setContext({
            organisationId: MOCK_ORGANISATION_IDS.cedarClinic,
        });
        expect(context.branchId).toBeNull();
    });

    it('refuses a branch outside the membership scope', async () => {
        const failure = await failureOf(() =>
            repositories.context.setContext({
                organisationId: MOCK_ORGANISATION_IDS.cedarClinic,
                branchId: MOCK_BRANCH_IDS.alQuoz,
            }),
        );
        expect(failure.code).toBe('context.branch_out_of_scope');
    });

    it('refuses an organisation the user is not an active member of', async () => {
        const other = make('single-org-owner');
        await signIn(other, MOCK_SCENARIOS['single-org-owner'].primaryEmail);
        const failure = await failureOf(() =>
            other.context.setContext({
                organisationId: MOCK_ORGANISATION_IDS.verdantKitchen,
            }),
        );
        expect(failure.code).toBe('context.organisation_forbidden');
    });

    it('reports a missing organisation identifier distinctly', async () => {
        const failure = await failureOf(() =>
            repositories.context.setContext({
                organisationId: '' as never,
            }),
        );
        expect(failure.code).toBe('context.organisation_required');
    });
});

describe('single-org-owner', () => {
    it('has exactly one active membership with exactly one branch, so both pickers can skip', async () => {
        const repositories = make('single-org-owner');
        await signIn(repositories, MOCK_SCENARIOS['single-org-owner'].primaryEmail);
        const me = await repositories.session.me();

        expect(me.memberships).toHaveLength(1);
        expect(me.memberships[0]?.branches).toHaveLength(1);
        expect(me.memberships[0]?.roles.map((role) => role.key)).toEqual(['organisation_owner']);
    });

    it('grants the owner management permissions', async () => {
        const repositories = make('single-org-owner');
        await signIn(repositories, MOCK_SCENARIOS['single-org-owner'].primaryEmail);
        const context = await repositories.context.setContext({
            organisationId: MOCK_ORGANISATION_IDS.cedarClinic,
        });
        expect(context.permissions).toContain('organisation.manage_current');
        expect(context.permissions).toContain('membership.invite_organisation');
    });
});

describe('customer-no-org', () => {
    it('is handed a global context immediately — no organisation selection (decision D1)', async () => {
        const repositories = make('customer-no-org');
        await signIn(repositories, MOCK_SCENARIOS['customer-no-org'].primaryEmail);
        const me = await repositories.session.me();

        expect(me.memberships).toEqual([]);
        expect(me.activeContext).not.toBeNull();
        expect(me.activeContext?.organisationId).toBeNull();
        expect(me.activeContext?.permissions).toEqual(['device.manage_own', 'session.revoke_own']);
        expect(me.activeContext?.entitlements).toEqual([]);
    });

    it('still refuses to set an organisation context it has no membership for', async () => {
        const repositories = make('customer-no-org');
        await signIn(repositories, MOCK_SCENARIOS['customer-no-org'].primaryEmail);
        const failure = await failureOf(() =>
            repositories.context.setContext({
                organisationId: MOCK_ORGANISATION_IDS.cedarClinic,
            }),
        );
        expect(failure.code).toBe('context.organisation_forbidden');
    });
});

describe('unverified-email', () => {
    const email = MOCK_SCENARIOS['unverified-email'].primaryEmail;

    it('signs in but reports the address as unconfirmed', async () => {
        const repositories = make('unverified-email');
        await signIn(repositories, email);
        const me = await repositories.session.me();
        expect(me.user.emailVerifiedAt).toBeNull();
        expect(await repositories.auth.verifyEmailStatus()).toEqual({
            email,
            verified: false,
            verifiedAt: null,
        });
    });

    it('refuses to establish an organisation context while unverified', async () => {
        const repositories = make('unverified-email');
        await signIn(repositories, email);
        const failure = await failureOf(() =>
            repositories.context.setContext({
                organisationId: MOCK_ORGANISATION_IDS.cedarClinic,
            }),
        );
        expect(failure.code).toBe('auth.email_unverified');
    });

    it('confirms the address on the first recheck after a resend', async () => {
        const repositories = make('unverified-email');
        await signIn(repositories, email);

        expect(await repositories.auth.resendVerification()).toEqual({
            cooldownSeconds: RESEND_COOLDOWN_SECONDS,
        });
        const status = await repositories.auth.verifyEmailStatus();
        expect(status.verified).toBe(true);
        expect(status.verifiedAt).not.toBeNull();
    });

    it('rate-limits a second resend inside the cooldown and allows one after it', async () => {
        const clock = fakeClock();
        const repositories = make('unverified-email', { now: clock.now });
        await signIn(repositories, email);

        await repositories.auth.resendVerification();
        const failure = await failureOf(() => repositories.auth.resendVerification());
        expect(failure.code).toBe('rate_limit.exceeded');
        if (failure.code !== 'rate_limit.exceeded') throw new Error('unreachable');
        expect(failure.retryAfterSeconds).toBe(RESEND_COOLDOWN_SECONDS);

        clock.advanceSeconds(RESEND_COOLDOWN_SECONDS);
        await expect(repositories.auth.resendVerification()).resolves.toEqual({
            cooldownSeconds: RESEND_COOLDOWN_SECONDS,
        });
    });
});

describe('two-factor-user', () => {
    const email = MOCK_SCENARIOS['two-factor-user'].primaryEmail;

    it('stops the correct password at a challenge instead of issuing a session', async () => {
        const repositories = make('two-factor-user');
        const result = await repositories.auth.login({ email, password: MOCK_PASSWORD });

        expect(result.status).toBe('two_factor_required');
        if (result.status !== 'two_factor_required') throw new Error('unreachable');
        expect(result.challengeId.length).toBeGreaterThan(0);
        expect(result.recoveryCodesAvailable).toBe(true);
        expect(repositories.tokenStore.get()).toBeNull();
    });

    it('completes the challenge with the authenticator code', async () => {
        const repositories = make('two-factor-user');
        const result = await repositories.auth.login({ email, password: MOCK_PASSWORD });
        if (result.status !== 'two_factor_required') throw new Error('unreachable');

        const session = await repositories.auth.challengeTwoFactor({
            challengeId: result.challengeId,
            code: MOCK_TOTP_CODE,
        });
        expect(repositories.tokenStore.get()).toBe(session.token);
        expect((await repositories.session.me()).user.email).toBe(email);
    });

    it('accepts a recovery code when the caller says so', async () => {
        const repositories = make('two-factor-user');
        const result = await repositories.auth.login({ email, password: MOCK_PASSWORD });
        if (result.status !== 'two_factor_required') throw new Error('unreachable');

        await expect(
            repositories.auth.challengeTwoFactor({
                challengeId: result.challengeId,
                code: MOCK_RECOVERY_CODE,
                recovery: true,
            }),
        ).resolves.toMatchObject({ userId: expect.any(String) });
    });

    it('maps a wrong code to a field-level validation failure', async () => {
        const repositories = make('two-factor-user');
        const result = await repositories.auth.login({ email, password: MOCK_PASSWORD });
        if (result.status !== 'two_factor_required') throw new Error('unreachable');

        const failure = await failureOf(() =>
            repositories.auth.challengeTwoFactor({
                challengeId: result.challengeId,
                code: '000000',
            }),
        );
        expect(failure.code).toBe('validation.failed');
        if (failure.code !== 'validation.failed') throw new Error('unreachable');
        expect(failure.fields['code']).toBeDefined();
    });

    it('rejects an unknown challenge identifier', async () => {
        const repositories = make('two-factor-user');
        const failure = await failureOf(() =>
            repositories.auth.challengeTwoFactor({ challengeId: 'nope', code: MOCK_TOTP_CODE }),
        );
        expect(failure.code).toBe('auth.invalid_credentials');
    });
});

describe('platform-admin', () => {
    it('is the only world whose context carries platform.access_admin', async () => {
        const repositories = make('platform-admin');
        await signIn(repositories, MOCK_SCENARIOS['platform-admin'].primaryEmail);
        const context = await repositories.context.setContext({
            organisationId: MOCK_ORGANISATION_IDS.cedarClinic,
        });
        expect(context.permissions).toContain('platform.access_admin');
    });
});

describe('sessions and tokens', () => {
    it('rejects every authenticated call before sign-in', async () => {
        const repositories = make('multi-org-dietitian');
        for (const operation of [
            () => repositories.session.me(),
            () => repositories.devices.list(),
            () => repositories.auth.verifyEmailStatus(),
            () =>
                repositories.context.setContext({
                    organisationId: MOCK_ORGANISATION_IDS.cedarClinic,
                }),
        ]) {
            expect((await failureOf(operation)).code).toBe('auth.unauthenticated');
        }
    });

    it('restores a session from a persisted token, which is what a page reload does', async () => {
        const tokenStore = createMemoryTokenStore();
        const first = make('multi-org-dietitian', { tokenStore });
        await signIn(first, MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail);
        const token = tokenStore.get();
        expect(token).not.toBeNull();

        const reloaded = make('multi-org-dietitian', {
            tokenStore: createMemoryTokenStore(token),
        });
        await expect(reloaded.session.me()).resolves.toMatchObject({
            user: { email: MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail },
        });
    });

    it('invalidates the token on logout', async () => {
        const repositories = make('multi-org-dietitian');
        await signIn(repositories, MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail);
        await repositories.auth.logout();

        expect(repositories.tokenStore.get()).toBeNull();
        expect((await failureOf(() => repositories.session.me())).code).toBe(
            'auth.unauthenticated',
        );
    });

    it('forgets the chosen context on logout', async () => {
        const tokenStore = createMemoryTokenStore();
        const repositories = make('multi-org-dietitian', { tokenStore });
        await signIn(repositories, MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail);
        await repositories.context.setContext({
            organisationId: MOCK_ORGANISATION_IDS.cedarClinic,
        });
        await repositories.auth.logout();
        await signIn(repositories, MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail);

        expect((await repositories.session.me()).activeContext).toBeNull();
    });
});

describe('sign-in failure paths', () => {
    it('maps a malformed email to an inline field error, not a credentials failure', async () => {
        const repositories = make('multi-org-dietitian');
        const failure = await failureOf(() =>
            repositories.auth.login({ email: 'not-an-email', password: MOCK_PASSWORD }),
        );
        expect(failure.code).toBe('validation.failed');
        if (failure.code !== 'validation.failed') throw new Error('unreachable');
        expect(failure.fields['email']).toBeDefined();
        expect(failure.correlationId).toBe('mock-multi-org-dietitian-login');
    });

    it('does not reveal whether an address exists', async () => {
        const repositories = make('multi-org-dietitian');
        const unknown = await failureOf(() =>
            repositories.auth.login({ email: 'nobody@example.com', password: MOCK_PASSWORD }),
        );
        const wrongPassword = await failureOf(() =>
            repositories.auth.login({
                email: MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail,
                password: 'wrong',
            }),
        );
        expect(unknown.code).toBe(wrongPassword.code);
        expect(unknown.message).toBe(wrongPassword.message);
    });

    it('rate-limits after the attempt limit and reports the wait', async () => {
        const repositories = make('multi-org-dietitian');
        const email = MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail;

        for (let attempt = 0; attempt < LOGIN_ATTEMPT_LIMIT; attempt += 1) {
            expect(
                (await failureOf(() => repositories.auth.login({ email, password: 'wrong' }))).code,
            ).toBe('auth.invalid_credentials');
        }

        const failure = await failureOf(() =>
            repositories.auth.login({ email, password: 'wrong' }),
        );
        expect(failure.code).toBe('rate_limit.exceeded');
        if (failure.code !== 'rate_limit.exceeded') throw new Error('unreachable');
        expect(failure.retryAfterSeconds).toBe(LOGIN_RATE_LIMIT_RETRY_AFTER_SECONDS);

        // Even the correct password is refused while the limit stands.
        expect(
            (await failureOf(() => repositories.auth.login({ email, password: MOCK_PASSWORD })))
                .code,
        ).toBe('rate_limit.exceeded');
    });

    it('clears the attempt counter once a sign-in succeeds', async () => {
        const repositories = make('multi-org-dietitian');
        const email = MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail;

        await failureOf(() => repositories.auth.login({ email, password: 'wrong' }));
        await signIn(repositories, email);
        await repositories.auth.logout();
        await signIn(repositories, email);
    });
});

describe('registration', () => {
    it('creates an unverified account and signs it straight in', async () => {
        const repositories = make('customer-no-org');
        const result = await repositories.auth.register({
            name: 'Yara Nassar',
            email: 'yara.nassar@example.com',
            password: 'correct-horse-battery',
            passwordConfirmation: 'correct-horse-battery',
            acceptTerms: true,
            acceptPrivacy: true,
        });

        expect(result.emailVerified).toBe(false);
        expect(repositories.tokenStore.get()).toBe(result.session.token);

        const me = await repositories.session.me();
        expect(me.user.email).toBe('yara.nassar@example.com');
        expect(me.user.emailVerifiedAt).toBeNull();
        expect(me.profile.displayName).toBe('Yara Nassar');
        expect(me.memberships).toEqual([]);
    });

    it('reports duplicate addresses, mismatched passwords and unaccepted consents by field', async () => {
        const repositories = make('customer-no-org');
        const failure = await failureOf(() =>
            repositories.auth.register({
                name: 'Nour Saleh',
                email: MOCK_SCENARIOS['customer-no-org'].primaryEmail,
                password: 'one-password',
                passwordConfirmation: 'another-password',
                acceptTerms: false,
                acceptPrivacy: false,
            }),
        );

        expect(failure.code).toBe('validation.failed');
        if (failure.code !== 'validation.failed') throw new Error('unreachable');
        expect(Object.keys(failure.fields).sort()).toEqual([
            'accept_privacy',
            'accept_terms',
            'email',
            'password_confirmation',
        ]);
    });

    it('lets the freshly registered account complete verification', async () => {
        const repositories = make('customer-no-org');
        await repositories.auth.register({
            name: 'Yara Nassar',
            email: 'yara.nassar@example.com',
            password: 'correct-horse-battery',
            passwordConfirmation: 'correct-horse-battery',
            acceptTerms: true,
            acceptPrivacy: true,
        });

        expect((await repositories.auth.verifyEmailStatus()).verified).toBe(false);
        await repositories.auth.resendVerification();
        expect((await repositories.auth.verifyEmailStatus()).verified).toBe(true);
    });
});

describe('password reset', () => {
    it('confirms neutrally for an unknown address', async () => {
        const repositories = make('multi-org-dietitian');
        await expect(
            repositories.auth.requestPasswordReset({ email: 'nobody@example.com' }),
        ).resolves.toBeUndefined();
    });

    it('rejects a malformed address inline', async () => {
        const repositories = make('multi-org-dietitian');
        const failure = await failureOf(() =>
            repositories.auth.requestPasswordReset({ email: 'nope' }),
        );
        expect(failure.code).toBe('validation.failed');
    });

    it('rejects an expired token and a mismatched confirmation together', async () => {
        const repositories = make('multi-org-dietitian');
        const failure = await failureOf(() =>
            repositories.auth.resetPassword({
                token: 'stale',
                email: MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail,
                password: 'a-new-password',
                passwordConfirmation: 'a-different-password',
            }),
        );
        expect(failure.code).toBe('validation.failed');
        if (failure.code !== 'validation.failed') throw new Error('unreachable');
        expect(Object.keys(failure.fields).sort()).toEqual(['password_confirmation', 'token']);
    });

    it('changes the password so the old one stops working', async () => {
        const repositories = make('multi-org-dietitian');
        const email = MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail;

        await repositories.auth.resetPassword({
            token: MOCK_PASSWORD_RESET_TOKEN,
            email,
            password: 'a-brand-new-password',
            passwordConfirmation: 'a-brand-new-password',
        });

        expect(
            (await failureOf(() => repositories.auth.login({ email, password: MOCK_PASSWORD })))
                .code,
        ).toBe('auth.invalid_credentials');
        await signIn(repositories, email, 'a-brand-new-password');
    });
});

describe('devices and step-up authentication', () => {
    const email = MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail;

    it('lists the seeded devices with exactly one current session', async () => {
        const repositories = make('multi-org-dietitian');
        await signIn(repositories, email);
        const devices = await repositories.devices.list();

        expect(devices).toHaveLength(3);
        expect(devices.filter((device) => device.isCurrent)).toHaveLength(1);
    });

    it('demands a password confirmation before the first revocation', async () => {
        const repositories = make('multi-org-dietitian');
        await signIn(repositories, email);

        const failure = await failureOf(() => repositories.devices.revoke(MOCK_DEVICE_IDS.phone));
        expect(failure.code).toBe('auth.step_up_required');
        expect(failure.retryable).toBe(false);
        expect(await repositories.devices.list()).toHaveLength(3);
    });

    it('revokes once the password has been confirmed', async () => {
        const repositories = make('multi-org-dietitian');
        await signIn(repositories, email);

        const confirmation = await repositories.auth.confirmPassword({ password: MOCK_PASSWORD });
        expect(Date.parse(confirmation.confirmedUntil)).toBeGreaterThan(Date.now() - 1000);

        await repositories.devices.revoke(MOCK_DEVICE_IDS.phone);
        const remaining = await repositories.devices.list();
        expect(remaining.map((device) => device.id)).not.toContain(MOCK_DEVICE_IDS.phone);
        expect(remaining).toHaveLength(2);
    });

    it('rejects a wrong password at the step-up prompt with a field error', async () => {
        const repositories = make('multi-org-dietitian');
        await signIn(repositories, email);

        const failure = await failureOf(() =>
            repositories.auth.confirmPassword({ password: 'wrong' }),
        );
        expect(failure.code).toBe('validation.failed');
        if (failure.code !== 'validation.failed') throw new Error('unreachable');
        expect(failure.fields['password']).toBeDefined();
    });

    it('closes the step-up window again once it expires', async () => {
        const clock = fakeClock();
        const repositories = make('multi-org-dietitian', { now: clock.now });
        await signIn(repositories, email);

        await repositories.auth.confirmPassword({ password: MOCK_PASSWORD });
        clock.advanceSeconds(301);

        expect(
            (await failureOf(() => repositories.devices.revoke(MOCK_DEVICE_IDS.tablet))).code,
        ).toBe('auth.step_up_required');
    });

    it('refuses to revoke the session doing the revoking', async () => {
        const repositories = make('multi-org-dietitian');
        await signIn(repositories, email);
        await repositories.auth.confirmPassword({ password: MOCK_PASSWORD });

        const failure = await failureOf(() => repositories.devices.revoke(MOCK_DEVICE_IDS.laptop));
        expect(failure.code).toBe('validation.failed');
    });

    it('refuses to revoke a device that is already gone', async () => {
        const repositories = make('multi-org-dietitian');
        await signIn(repositories, email);
        await repositories.auth.confirmPassword({ password: MOCK_PASSWORD });
        await repositories.devices.revoke(MOCK_DEVICE_IDS.phone);

        expect(
            (await failureOf(() => repositories.devices.revoke(MOCK_DEVICE_IDS.phone))).code,
        ).toBe('validation.failed');
    });
});

describe('two-factor enrolment', () => {
    it('issues a deterministic secret and turns the flag on once confirmed', async () => {
        const repositories = make('single-org-owner');
        await signIn(repositories, MOCK_SCENARIOS['single-org-owner'].primaryEmail);

        const setup = await repositories.auth.enableTwoFactor();
        expect(setup.secret).toBe('JBSWY3DPEHPK3PXP');
        expect(setup.otpauthUri).toContain('otpauth://totp/Healthy360:');
        expect(setup.recoveryCodes).toEqual([MOCK_RECOVERY_CODE]);
        expect((await repositories.session.me()).user.twoFactorEnabled).toBe(false);

        await repositories.auth.confirmTwoFactor({ code: MOCK_TOTP_CODE });
        expect((await repositories.session.me()).user.twoFactorEnabled).toBe(true);
    });

    it('rejects a wrong confirmation code by field', async () => {
        const repositories = make('single-org-owner');
        await signIn(repositories, MOCK_SCENARIOS['single-org-owner'].primaryEmail);
        await repositories.auth.enableTwoFactor();

        const failure = await failureOf(() =>
            repositories.auth.confirmTwoFactor({ code: '999999' }),
        );
        expect(failure.code).toBe('validation.failed');
    });

    it('refuses a confirmation that was never started', async () => {
        const repositories = make('single-org-owner');
        await signIn(repositories, MOCK_SCENARIOS['single-org-owner'].primaryEmail);

        expect(
            (await failureOf(() => repositories.auth.confirmTwoFactor({ code: MOCK_TOTP_CODE })))
                .code,
        ).toBe('server');
    });
});

/**
 * The two closure checks the bundle binds across worlds (J2).
 *
 * Asserted here rather than in `account/account.test.ts` because they are the only two blockers that
 * cannot be exercised by the account world alone: one reads the foundation `MockStore`'s session,
 * the other the B2B applicant's agreement. What is being pinned is that neither reports
 * `not_applicable` any more — that verdict means *nobody asked*, and both modules are present — and
 * that each answers from a seeded world rather than a hand-built double.
 */
describe('the closure blockers the bundle wires across worlds', () => {
    async function blockerOf(repositories: MockRepositories, code: string) {
        const preconditions = await repositories.account.getClosurePreconditions();
        const blocker = preconditions.blockers.find((entry) => entry.code === code);
        expect(blocker).toBeDefined();
        return { blocker: blocker!, canClose: preconditions.canClose };
    }

    it('blocks on the signed-in dietitian’s active memberships, and counts only the active ones', async () => {
        const repositories = make('multi-org-dietitian');
        await signIn(repositories, MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail);

        const { blocker, canClose } = await blockerOf(repositories, 'organisation_memberships');
        expect(blocker.status).toBe('blocking');
        // Three memberships are seeded and one of them is `pending`. A pending invitation is not a
        // seat somebody holds, so it must not stand in the way of their closure.
        expect(blocker.count).toBe(2);
        expect(blocker.reason).toBe('memberships_live');
        expect(canClose).toBe(false);
    });

    it('clears for a consumer with no memberships — and says clear, not not_applicable', async () => {
        const repositories = make('customer-no-org');
        await signIn(repositories, MOCK_SCENARIOS['customer-no-org'].primaryEmail);

        const { blocker } = await blockerOf(repositories, 'organisation_memberships');
        expect(blocker.status).toBe('clear');
        expect(blocker.count).toBe(0);
    });

    /**
     * Signed out answers zero rather than throwing. The wizard lives behind the session guard so
     * this is unreachable in the application; it is pinned because a port that raised would turn a
     * missing session into an unhandled rejection inside a preconditions read.
     */
    it('does not raise when nobody is signed in', async () => {
        const { blocker } = await blockerOf(
            make('multi-org-dietitian'),
            'organisation_memberships',
        );
        expect(blocker.status).toBe('clear');
    });

    it('is clear while the applicant has no agreement waiting, and blocks once one does', async () => {
        const repositories = make('customer-no-org');
        await signIn(repositories, MOCK_SCENARIOS['customer-no-org'].primaryEmail);

        // The default B2B fixture is a half-finished draft: no agreement, nothing to sign.
        expect((await blockerOf(repositories, 'pending_b2b_signatures')).blocker.status).toBe(
            'clear',
        );

        repositories.b2bApplicationStore.startApplication();
        repositories.b2bApplicationStore.forceState('agreement_pending');

        const { blocker, canClose } = await blockerOf(repositories, 'pending_b2b_signatures');
        expect(blocker.status).toBe('blocking');
        expect(blocker.count).toBe(1);
        expect(blocker.reason).toBe('signatures_pending');
        expect(canClose).toBe(false);
    });
});

describe('simulated latency', () => {
    it('is applied on every call and is configurable to zero', async () => {
        const slow = createMockRepositories({ scenario: 'customer-no-org', latencyMs: 40 });
        const started = Date.now();
        await slow.auth.login({
            email: MOCK_SCENARIOS['customer-no-org'].primaryEmail,
            password: MOCK_PASSWORD,
        });
        expect(Date.now() - started).toBeGreaterThanOrEqual(30);
    });
});
