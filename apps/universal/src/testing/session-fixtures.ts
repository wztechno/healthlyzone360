import type { MeResponse, PendingConsent } from '@healthy360/api-client';
import { RoleId } from '@healthy360/domain-types';
import type {
    ActiveContext,
    Branch,
    BranchId,
    Membership,
    MembershipId,
    Organisation,
    OrganisationId,
    Profile,
    SessionUser,
    UserId,
} from '@healthy360/domain-types';

/**
 * Hand-authored session material for stub-backed screen tests.
 *
 * These replace the deleted mock world's accounts: a test no longer signs in through a fixture
 * auth repository — it *declares* the session the screen should see and hands it to
 * `renderStubScreen`. Every builder returns the minimal valid shape with overridable fields, and
 * the canned permission sets mirror the backend's template roles
 * (`apps/api/app-modules/access-control/src/Services/PermissionRegistry.php`), which is the one
 * registry that decides what a role can actually do.
 */

/** The backend `kitchen_manager` template role's grant, as of INV1/O6. */
export const KITCHEN_MANAGER_PERMISSIONS: readonly string[] = [
    'organisation.view_current',
    'branch.view_current',
    'branch.manage_current',
    'catalogue.view_organisation',
    'catalogue.manage_organisation',
    'catalogue.publish_organisation',
    'recipe.view_organisation',
    'recipe.manage_organisation',
    'recipe.publish_organisation',
    'recipe.view_costs_organisation',
    'price_list.view_organisation',
    'price_list.manage_organisation',
    'plan.manage_organisation',
    'delivery_zone.manage_organisation',
    'order.view_organisation',
    'order.manage_organisation',
    // C2. The order desk, in full. The backend grants all three to `kitchen_manager` deliberately —
    // a manager is who a desk agent escalates to, and one who had to borrow an agent's login to
    // take an order would be a control that had made itself unusable. Added here when the sale
    // wizard first needed them, which is exactly the drift this fixture's "mirrors the template
    // roles" promise exists to prevent.
    'order.create_on_behalf_organisation',
    'customer.create_on_behalf_organisation',
    'order.view_customer_contact_organisation',
    // B1/B4. The backend grants this pair to `kitchen_manager` alongside the tariff pair — reading
    // what corporate buyers submitted against this kitchen's programmes, and naming a price against
    // it. Absent here until the kitchen gained a screen that needed them, which is exactly the drift
    // this fixture's "mirrors the template roles" promise exists to prevent.
    'b2b_quotation.view_organisation',
    'b2b_quotation.quote_organisation',
    'inventory.view_organisation',
    'inventory.manage_organisation',
    'inventory.view_costs_organisation',
    'device.manage_own',
    'session.revoke_own',
];

export const ORGANISATION_OWNER_PERMISSIONS: readonly string[] = [
    'organisation.view_current',
    'organisation.manage_current',
    'branch.view_current',
    'branch.manage_current',
    'membership.view_organisation',
    'membership.invite_organisation',
    'user.manage_organisation',
    'device.manage_own',
    'session.revoke_own',
];

export const PLATFORM_ADMINISTRATOR_PERMISSIONS: readonly string[] = [
    'organisation.manage_platform',
    'organisation.view_current',
    'branch.view_current',
    'membership.view_organisation',
    'device.manage_own',
    'session.revoke_own',
];

/** What a consumer holds on their global identity, outside any organisation (plan §9 / D1). */
export const CONSUMER_PERMISSIONS: readonly string[] = ['device.manage_own', 'session.revoke_own'];

export const TEST_USER_ID = 'test-0000-user-0001' as UserId;
export const TEST_ORGANISATION_ID = 'test-0000-org-0001' as OrganisationId;
export const TEST_BRANCH_ID = 'test-0000-branch-0001' as BranchId;
export const TEST_MEMBERSHIP_ID = 'test-0000-membership-0001' as MembershipId;

export function testProfile(overrides: Partial<Profile> = {}): Profile {
    return {
        userId: TEST_USER_ID,
        displayName: 'Test Person',
        givenName: 'Test',
        familyName: 'Person',
        avatarUrl: null,
        preferredLocale: 'en',
        timeZone: 'Asia/Dubai',
        ...overrides,
    };
}

export function testSessionUser(overrides: Partial<SessionUser> = {}): SessionUser {
    return {
        id: TEST_USER_ID,
        email: 'test.person@example.test',
        emailVerifiedAt: '2026-08-01T09:00:00.000Z',
        twoFactorEnabled: false,
        profile: testProfile(),
        createdAt: '2026-07-01T09:00:00.000Z',
        ...overrides,
    };
}

export function testOrganisation(overrides: Partial<Organisation> = {}): Organisation {
    return {
        id: TEST_ORGANISATION_ID,
        name: 'Test Kitchen',
        slug: 'test-kitchen',
        type: 'kitchen',
        countryCode: 'AE',
        defaultLocale: 'en',
        isActive: true,
        ...overrides,
    };
}

export function testBranch(overrides: Partial<Branch> = {}): Branch {
    return {
        id: TEST_BRANCH_ID,
        organisationId: TEST_ORGANISATION_ID,
        name: 'Main Branch',
        code: 'main',
        countryCode: 'AE',
        timeZone: 'Asia/Dubai',
        isActive: true,
        ...overrides,
    };
}

export function testMembership(overrides: Partial<Membership> = {}): Membership {
    return {
        id: TEST_MEMBERSHIP_ID,
        userId: TEST_USER_ID,
        organisation: testOrganisation(),
        status: 'active',
        roles: [
            {
                id: RoleId.unsafe('test-0000-role-0001'),
                key: 'kitchen_manager',
                name: 'Kitchen manager',
            },
        ],
        branches: [],
        startsAt: null,
        expiresAt: null,
        ...overrides,
    };
}

export function testActiveContext(overrides: Partial<ActiveContext> = {}): ActiveContext {
    return {
        organisationId: TEST_ORGANISATION_ID,
        branchId: TEST_BRANCH_ID,
        membershipId: TEST_MEMBERSHIP_ID,
        permissions: KITCHEN_MANAGER_PERMISSIONS,
        entitlements: [],
        permissionVersion: 1,
        ...overrides,
    };
}

export interface TestMeResponseOverrides {
    readonly user?: Partial<SessionUser>;
    readonly profile?: Partial<Profile>;
    readonly memberships?: readonly Membership[];
    readonly activeContext?: ActiveContext | null;
    readonly pendingConsents?: readonly PendingConsent[];
}

/** A signed-in consumer by default: no memberships, global permissions only. */
export function testMeResponse(overrides: TestMeResponseOverrides = {}): MeResponse {
    const user = testSessionUser(overrides.user);
    return {
        user,
        profile: testProfile({ userId: user.id, ...overrides.profile }),
        memberships: overrides.memberships ?? [],
        activeContext:
            overrides.activeContext === undefined
                ? testActiveContext({
                      organisationId: null,
                      branchId: null,
                      membershipId: null,
                      permissions: CONSUMER_PERMISSIONS,
                  })
                : overrides.activeContext,
        pendingConsents: overrides.pendingConsents ?? [],
    };
}

/** A kitchen manager working at the test kitchen — the session most workspace suites need. */
export function kitchenManagerSession(overrides: TestMeResponseOverrides = {}): MeResponse {
    return testMeResponse({
        memberships: [testMembership()],
        activeContext: testActiveContext(),
        ...overrides,
    });
}
