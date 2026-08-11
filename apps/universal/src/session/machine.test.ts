import type { MeResponse } from '@healthy360/api-client';
import type {
    BranchId,
    Membership,
    MembershipId,
    MembershipRole,
    OrganisationId,
    RoleId,
} from '@healthy360/domain-types';

import {
    KITCHEN_MANAGER_PERMISSIONS,
    ORGANISATION_OWNER_PERMISSIONS,
    testActiveContext,
    testBranch,
    testMeResponse,
    testMembership,
    testOrganisation,
} from '../testing/session-fixtures.ts';
import type { TestMeResponseOverrides } from '../testing/session-fixtures.ts';
import {
    SESSION_PHASES,
    buildAccessState,
    membershipRequiresBranchSelection,
    resolveSessionPhase,
    selectableMemberships,
    toKernelSessionState,
} from './machine.ts';
import type { SessionPhase } from './machine.ts';

/**
 * `machine.ts` is a pure projection of a `MeResponse`, so every case here *authors* the payload it
 * wants rather than signing into a fixture world and hoping it still contains the shape under test.
 * The three memberships below are the only world these tests need: an organisation the person works
 * across two branches, one they work at a single branch, and an invitation they have not accepted.
 */

const role = (key: string, name: string): MembershipRole => ({
    id: `test-0000-role-${key}` as RoleId,
    key,
    name,
});

const CLINIC = testOrganisation({
    id: 'test-0000-org-clinic' as OrganisationId,
    name: 'Cedar Clinic',
    slug: 'cedar-clinic',
    type: 'clinic',
});

const HAMRA = testBranch({
    id: 'test-0000-branch-hamra' as BranchId,
    organisationId: CLINIC.id,
    name: 'Hamra',
    code: 'hamra',
});

const JOUNIEH = testBranch({
    id: 'test-0000-branch-jounieh' as BranchId,
    organisationId: CLINIC.id,
    name: 'Jounieh',
    code: 'jounieh',
});

/** Branch-scoped: two branches, so the picker has something to ask. */
const CLINIC_MEMBERSHIP: Membership = testMembership({
    id: 'test-0000-membership-clinic' as MembershipId,
    organisation: CLINIC,
    roles: [role('clinic_dietitian', 'Clinic dietitian')],
    branches: [HAMRA, JOUNIEH],
});

/** Exactly one branch: the server applies it, so nothing is selectable. */
const KITCHEN_MEMBERSHIP: Membership = testMembership({
    id: 'test-0000-membership-kitchen' as MembershipId,
    roles: [role('kitchen_manager', 'Kitchen manager')],
    branches: [testBranch()],
});

/** Listed by a picker, never selectable. */
const PENDING_MEMBERSHIP: Membership = testMembership({
    id: 'test-0000-membership-pending' as MembershipId,
    status: 'pending',
    roles: [role('clinic_receptionist', 'Clinic receptionist')],
    branches: [],
});

/** A verified person in two organisations plus a pending invitation, with no context chosen yet. */
function multiOrgSession(overrides: TestMeResponseOverrides = {}): MeResponse {
    return testMeResponse({
        memberships: [CLINIC_MEMBERSHIP, KITCHEN_MEMBERSHIP, PENDING_MEMBERSHIP],
        activeContext: null,
        ...overrides,
    });
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

    it('is authenticated but not further while the email is unconfirmed', () => {
        const me = testMeResponse({ user: { emailVerifiedAt: null } });

        expect(resolveSessionPhase({ ...base, me })).toBe('authenticated');
    });

    it('is contextPending when a verified user has not chosen an organisation', () => {
        const me = multiOrgSession();

        expect(me.activeContext).toBeNull();
        expect(resolveSessionPhase({ ...base, me })).toBe('contextPending');
    });

    it('is ready as soon as the server confirms a context', () => {
        const me = multiOrgSession({
            activeContext: testActiveContext({
                organisationId: CLINIC.id,
                branchId: HAMRA.id,
                membershipId: CLINIC_MEMBERSHIP.id,
            }),
        });

        expect(resolveSessionPhase({ ...base, me })).toBe('ready');
    });

    /** Decision D1: a consumer gets a global context immediately and is therefore ready at once. */
    it('is ready for a consumer with no organisation at all', () => {
        const me = testMeResponse();

        expect(me.memberships).toHaveLength(0);
        expect(me.activeContext?.organisationId).toBeNull();
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

    it('takes permissions from the server context and never derives them from roles', () => {
        // Deliberately mismatched: the membership carries the *kitchen manager* role while the
        // server's context grants the *organisation owner* set. Only the context may win — a client
        // that inferred permissions from the role would grant `catalogue.manage_organisation` and
        // withhold `organisation.manage_current`, which is exactly backwards.
        const membership = testMembership({ roles: [role('kitchen_manager', 'Kitchen manager')] });
        const me = testMeResponse({
            memberships: [membership],
            activeContext: testActiveContext({
                membershipId: membership.id,
                permissions: ORGANISATION_OWNER_PERMISSIONS,
                entitlements: ['feature.multi_branch', 'feature.audit_export'],
            }),
        });

        const state = buildAccessState({ mode: 'staff', phase: 'ready', me });

        expect(state.session).toBe('authenticated');
        expect(state.emailVerified).toBe(true);
        expect(state.organisation?.membershipStatus).toBe('active');
        expect(state.permissions.has('organisation.manage_current')).toBe(true);
        expect(KITCHEN_MANAGER_PERMISSIONS).toContain('catalogue.manage_organisation');
        expect(state.permissions.has('catalogue.manage_organisation')).toBe(false);
        expect([...state.entitlements].every((key) => key.startsWith('feature.'))).toBe(true);
    });

    it('marks a branch-scoped membership as needing a branch, and a single-branch one as not', () => {
        expect(CLINIC_MEMBERSHIP.branches).toHaveLength(2);
        expect(KITCHEN_MEMBERSHIP.branches).toHaveLength(1);

        expect(membershipRequiresBranchSelection(CLINIC_MEMBERSHIP)).toBe(true);
        expect(membershipRequiresBranchSelection(KITCHEN_MEMBERSHIP)).toBe(false);
    });

    it('carries the branch only when it belongs to the active organisation', () => {
        const me = multiOrgSession({
            activeContext: testActiveContext({
                organisationId: CLINIC.id,
                branchId: JOUNIEH.id,
                membershipId: CLINIC_MEMBERSHIP.id,
            }),
        });

        const state = buildAccessState({ mode: 'all-dev', phase: 'ready', me });

        expect(state.branch?.id).toBe(JOUNIEH.id);
        expect(state.branch?.organisationId).toBe(CLINIC.id);
    });
});

describe('selectableMemberships', () => {
    it('keeps only active memberships', () => {
        const me = multiOrgSession();

        expect(me.memberships).toHaveLength(3);
        expect(selectableMemberships(me.memberships)).toHaveLength(2);
        expect(
            selectableMemberships(me.memberships).every(
                (membership) => membership.status === 'active',
            ),
        ).toBe(true);
    });
});
