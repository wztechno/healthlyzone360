import { createMockRepositories } from '@healthy360/api-client/mock';
import type { MeResponse } from '@healthy360/api-client';
import {
    SESSION_PHASES,
    buildAccessState,
    membershipRequiresBranchSelection,
    resolveSessionPhase,
    selectableMemberships,
    toKernelSessionState,
} from './machine.ts';
import type { SessionPhase } from './machine.ts';

/** Signs in against a mock world and returns the real `me()` payload. */
async function loadMe(
    scenario: Parameters<typeof createMockRepositories>[0] extends undefined
        ? never
        : NonNullable<Parameters<typeof createMockRepositories>[0]>['scenario'],
    email: string,
): Promise<MeResponse> {
    const repositories = createMockRepositories({ scenario, latencyMs: 0 });
    await repositories.auth.login({ email, password: 'password' });
    return repositories.session.me();
}

const base = {
    repositoriesReady: true,
    hasToken: true,
    me: null,
    failure: null,
} as const;

describe('SESSION_PHASES', () => {
    it('declares the lifecycle in order', () => {
        expect([...SESSION_PHASES]).toEqual([
            'restoring',
            'anonymous',
            'authenticated',
            'contextPending',
            'ready',
        ]);
    });

    it('collapses onto the kernel three-state view', () => {
        const expected: Readonly<Record<SessionPhase, string>> = {
            restoring: 'restoring',
            anonymous: 'anonymous',
            authenticated: 'authenticated',
            contextPending: 'authenticated',
            ready: 'authenticated',
        };
        for (const phase of SESSION_PHASES) {
            expect(toKernelSessionState(phase)).toBe(expected[phase]);
        }
    });
});

describe('resolveSessionPhase', () => {
    it('is restoring until the repositories exist', () => {
        expect(resolveSessionPhase({ ...base, repositoriesReady: false })).toBe('restoring');
    });

    it('is anonymous with no token and no session', () => {
        expect(resolveSessionPhase({ ...base, hasToken: false })).toBe('anonymous');
    });

    it('is restoring while a persisted token is being exchanged', () => {
        expect(resolveSessionPhase(base)).toBe('restoring');
    });

    it('is anonymous once the server rejects the token', () => {
        expect(
            resolveSessionPhase({
                ...base,
                failure: {
                    code: 'auth.unauthenticated',
                    message: 'gone',
                    correlationId: null,
                    retryable: false,
                },
            }),
        ).toBe('anonymous');
    });

    /** A flaky connection must not become an involuntary logout. */
    it.each(['network', 'server'] as const)('stays restoring on a %s failure', (code) => {
        expect(
            resolveSessionPhase({
                ...base,
                failure: { code, message: 'boom', correlationId: null, retryable: true },
            }),
        ).toBe('restoring');
    });

    it('is authenticated but not further while the email is unconfirmed', async () => {
        const me = await loadMe('unverified-email', 'rami.aziz@example.com');
        expect(resolveSessionPhase({ ...base, me })).toBe('authenticated');
    });

    it('is contextPending when a verified user has not chosen an organisation', async () => {
        const me = await loadMe('multi-org-dietitian', 'layla.haddad@cedarclinic.example');
        expect(me.activeContext).toBeNull();
        expect(resolveSessionPhase({ ...base, me })).toBe('contextPending');
    });

    it('is ready as soon as the server confirms a context', async () => {
        const repositories = createMockRepositories({
            scenario: 'multi-org-dietitian',
            latencyMs: 0,
        });
        await repositories.auth.login({
            email: 'layla.haddad@cedarclinic.example',
            password: 'password',
        });
        const me = await repositories.session.me();
        const organisationId = me.memberships[0]!.organisation.id;
        await repositories.context.setContext({ organisationId });

        expect(resolveSessionPhase({ ...base, me: await repositories.session.me() })).toBe('ready');
    });

    /** Decision D1: a consumer gets a global context immediately and is therefore ready at once. */
    it('is ready for a consumer with no organisation at all', async () => {
        const me = await loadMe('customer-no-org', 'nour.saleh@example.com');
        expect(resolveSessionPhase({ ...base, me })).toBe('ready');
    });
});

describe('buildAccessState', () => {
    it('projects an anonymous session onto empty permissions', () => {
        const state = buildAccessState({ mode: 'staff', phase: 'anonymous', me: null });

        expect(state.session).toBe('anonymous');
        expect(state.emailVerified).toBe(false);
        expect(state.organisation).toBeUndefined();
        expect(state.permissions.size).toBe(0);
        expect(state.entitlements.size).toBe(0);
    });

    it('takes permissions from the server context and never derives them from roles', async () => {
        const repositories = createMockRepositories({
            scenario: 'single-org-owner',
            latencyMs: 0,
        });
        await repositories.auth.login({
            email: 'omar.khoury@cedarclinic.example',
            password: 'password',
        });
        const first = await repositories.session.me();
        await repositories.context.setContext({
            organisationId: first.memberships[0]!.organisation.id,
        });
        const me = await repositories.session.me();

        const state = buildAccessState({ mode: 'staff', phase: 'ready', me });

        expect(state.session).toBe('authenticated');
        expect(state.emailVerified).toBe(true);
        expect(state.organisation?.membershipStatus).toBe('active');
        expect(state.permissions.has('organisation.manage_current')).toBe(true);
        expect([...state.entitlements].every((key) => key.startsWith('feature.'))).toBe(true);
    });

    it('marks a branch-scoped membership as needing a branch, and a single-branch one as not', async () => {
        const me = await loadMe('multi-org-dietitian', 'layla.haddad@cedarclinic.example');
        const [clinic, kitchen] = me.memberships;

        expect(membershipRequiresBranchSelection(clinic!)).toBe(true);
        expect(membershipRequiresBranchSelection(kitchen!)).toBe(false);
    });

    it('carries the branch only when it belongs to the active organisation', async () => {
        const repositories = createMockRepositories({
            scenario: 'multi-org-dietitian',
            latencyMs: 0,
        });
        await repositories.auth.login({
            email: 'layla.haddad@cedarclinic.example',
            password: 'password',
        });
        const initial = await repositories.session.me();
        const clinic = initial.memberships[0]!;
        await repositories.context.setContext({
            organisationId: clinic.organisation.id,
            branchId: clinic.branches[1]!.id,
        });

        const state = buildAccessState({
            mode: 'all-dev',
            phase: 'ready',
            me: await repositories.session.me(),
        });

        expect(state.branch?.id).toBe(clinic.branches[1]!.id);
        expect(state.branch?.organisationId).toBe(clinic.organisation.id);
    });
});

describe('selectableMemberships', () => {
    it('keeps only active memberships', async () => {
        const me = await loadMe('multi-org-dietitian', 'layla.haddad@cedarclinic.example');

        expect(me.memberships).toHaveLength(3);
        expect(selectableMemberships(me.memberships)).toHaveLength(2);
        expect(
            selectableMemberships(me.memberships).every(
                (membership) => membership.status === 'active',
            ),
        ).toBe(true);
    });
});
