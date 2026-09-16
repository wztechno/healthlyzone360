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
    // SUP3. The backend grants the supply-order code to `kitchen_manager` too — the manager is the
    // stock-responsible person by construction. Listed here rather than left out because every
    // kitchen suite renders through this session, and a screen gated on a code the fixture lacks
    // renders the forbidden page instead of the thing under test. A suite proving the boundary
    // subtracts it explicitly.
    'inventory.order_supplies_organisation',
    // S1/C4. The backend has granted `subscription.view_organisation` to `kitchen_manager` since the
    // schedule projection landed, and it is deliberately *not* folded into `order.view_organisation`
    // there: a subscription is a standing commercial arrangement with a captured price, and reading
    // today's order list is not by itself a reason to see who is committed to what. Added here when
    // the order-desk calendar first needed it — its endpoint requires this code *and* the order one,
    // because two of its three bases are subscription arithmetic — which is exactly the drift this
    // fixture's "mirrors the template roles" promise exists to prevent.
    'subscription.view_organisation',
    // AA1. Two more the registry has always granted `kitchen_manager` and this list omitted, found
    // by diffing the two rather than by a screen going missing: a manager reads the staff list, and
    // holds the plan publish code beside the plan manage code that was already here.
    'membership.view_organisation',
    'plan.publish_organisation',
    // **A deliberate deviation, recorded rather than quietly kept.** The registry grants these two
    // own-scope codes to `member` and to `organisation_owner`, and not to `kitchen_manager`. They
    // stay here because every kitchen suite renders through this session inside the app shell, whose
    // workspace navigation gates the Devices entry on `device.manage_own` — so a fixture faithful on
    // this point would make thirty suites assert against a rail that a real kitchen manager does see
    // (they hold `member` as well, in every deployment that seeds one). A suite proving the boundary
    // subtracts them explicitly.
    'device.manage_own',
    'session.revoke_own',
];

/**
 * Every organisation-scoped code, which is what `organisation_owner` is defined as.
 *
 * It held nine codes until AA1, one of which — `organisation.manage_current` — is not a permission
 * this platform has ever registered: the real code is `organisation.update_current`. So a fixture
 * whose whole promise is that it mirrors `PermissionRegistry` was granting an owner a fiction and
 * withholding thirty-five real codes, and every suite that used it was testing a narrower person
 * than the one it named.
 *
 * Listed in the registry's own order rather than sorted, so a diff against
 * `PermissionRegistry::organisationPermissions()` reads straight down.
 */
export const ORGANISATION_OWNER_PERMISSIONS: readonly string[] = [
    'organisation.view_current',
    'organisation.update_current',
    'branch.view_current',
    'branch.manage_current',
    'membership.view_organisation',
    'membership.invite_organisation',
    'membership.update_organisation',
    'membership.end_organisation',
    'role.view_organisation',
    'role.manage_organisation',
    'user.manage_organisation',
    'session.revoke_own',
    'device.manage_own',
    'profile.view_own',
    'profile.update_own',
    'consent.view_own',
    'consent.manage_own',
    'entitlement.view_organisation',
    'subscription.view_organisation',
    'audit.view_organisation',
    'catalogue.view_organisation',
    'catalogue.manage_organisation',
    'recipe.view_organisation',
    'recipe.manage_organisation',
    'recipe.publish_organisation',
    'recipe.view_costs_organisation',
    'catalogue.publish_organisation',
    'price_list.view_organisation',
    'price_list.manage_organisation',
    'plan.manage_organisation',
    'plan.publish_organisation',
    'delivery_zone.manage_organisation',
    'order.view_organisation',
    'order.manage_organisation',
    'order.view_customer_contact_organisation',
    'order.create_on_behalf_organisation',
    'customer.create_on_behalf_organisation',
    'b2b_quotation.view_organisation',
    'b2b_quotation.quote_organisation',
    'inventory.view_organisation',
    'inventory.manage_organisation',
    'inventory.view_costs_organisation',
    'inventory.order_supplies_organisation',
];

/**
 * `organisation_admin` — the permissions administrator (AA1).
 *
 * Every organisation code except `organisation.update_current`, which is the swap that makes the
 * name true: the role gained `role.manage_organisation`, because an administrator who could not
 * administer access was a name with nothing behind it, and gave up the legal identity of the
 * business in exchange. Without the trade it would be `organisation_owner` spelled differently.
 */
export const PERMISSIONS_ADMINISTRATOR_PERMISSIONS: readonly string[] = [
    'organisation.view_current',
    'branch.view_current',
    'branch.manage_current',
    'membership.view_organisation',
    'membership.invite_organisation',
    'membership.update_organisation',
    'membership.end_organisation',
    'role.view_organisation',
    'role.manage_organisation',
    'user.manage_organisation',
    'session.revoke_own',
    'device.manage_own',
    'profile.view_own',
    'profile.update_own',
    'consent.view_own',
    'consent.manage_own',
    'entitlement.view_organisation',
    'subscription.view_organisation',
    'audit.view_organisation',
    'catalogue.view_organisation',
    'catalogue.manage_organisation',
    'recipe.view_organisation',
    'recipe.manage_organisation',
    'recipe.publish_organisation',
    'recipe.view_costs_organisation',
    'catalogue.publish_organisation',
    'price_list.view_organisation',
    'price_list.manage_organisation',
    'plan.manage_organisation',
    'plan.publish_organisation',
    'delivery_zone.manage_organisation',
    'order.view_organisation',
    'order.manage_organisation',
    'order.view_customer_contact_organisation',
    'order.create_on_behalf_organisation',
    'customer.create_on_behalf_organisation',
    'b2b_quotation.view_organisation',
    'b2b_quotation.quote_organisation',
    'inventory.view_organisation',
    'inventory.manage_organisation',
    'inventory.view_costs_organisation',
    'inventory.order_supplies_organisation',
];

/**
 * `procurement_manager` — purchasing (AA1).
 *
 * The narrowest useful test of the cost line: it crosses INV1's split, because a buyer who cannot
 * see what the last crate cost is guessing — and it holds neither `price_list` code, because what
 * the kitchen *charges* is the commercial side's.
 */
export const PROCUREMENT_MANAGER_PERMISSIONS: readonly string[] = [
    'organisation.view_current',
    'branch.view_current',
    'catalogue.view_organisation',
    'inventory.view_organisation',
    'inventory.manage_organisation',
    'inventory.view_costs_organisation',
    'inventory.order_supplies_organisation',
];

/**
 * `finance_manager` — finance (AA1).
 *
 * Almost entirely reads. `order.manage_organisation` is absent deliberately, which is why this role
 * cannot open the order desk's cash report — a fact worth having a fixture for, because it is the
 * one visible cost of the line the registry draws there.
 */
export const FINANCE_MANAGER_PERMISSIONS: readonly string[] = [
    'organisation.view_current',
    'branch.view_current',
    'catalogue.view_organisation',
    'recipe.view_organisation',
    'recipe.view_costs_organisation',
    'price_list.view_organisation',
    'order.view_organisation',
    'subscription.view_organisation',
    'b2b_quotation.view_organisation',
    'inventory.view_organisation',
    'inventory.view_costs_organisation',
    'audit.view_organisation',
];

/**
 * `member` — somebody who belongs to an organisation and can do nothing in it.
 *
 * The registry's own floor: see the organisation, manage your own profile, devices, sessions and
 * consents, and nothing else. Every kitchen screen refuses this person, which is exactly what makes
 * it the right fixture for a suite proving that a gate refuses.
 *
 * Seven kitchen suites used to reach for `ORGANISATION_OWNER_PERMISSIONS` for that job, under a
 * local helper whose docstring read "an organisation owner … and no catalogue permission at all".
 * That was true only of the nine-code fixture, and false of the role it named: an owner holds every
 * organisation code there is. Correcting the owner set turned seven refusal tests into seven tests
 * of nothing, which is how the drift was found.
 */
export const MEMBER_PERMISSIONS: readonly string[] = [
    'organisation.view_current',
    'session.revoke_own',
    'device.manage_own',
    'profile.view_own',
    'profile.update_own',
    'consent.view_own',
    'consent.manage_own',
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
        mustChangePassword: false,
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

/**
 * A permissions administrator at the test kitchen — the session the access console suites need.
 *
 * Its own builder rather than `kitchenManagerSession` with an override, because the point of the
 * console suites is *which* codes open which screens, and a session assembled at the call site is
 * one a later edit can quietly widen.
 */
export function permissionsAdministratorSession(
    overrides: TestMeResponseOverrides = {},
): MeResponse {
    return testMeResponse({
        memberships: [testMembership()],
        activeContext: testActiveContext({
            permissions: PERMISSIONS_ADMINISTRATOR_PERMISSIONS,
        }),
        ...overrides,
    });
}

/** A kitchen manager working at the test kitchen — the session most workspace suites need. */
export function kitchenManagerSession(overrides: TestMeResponseOverrides = {}): MeResponse {
    return testMeResponse({
        memberships: [testMembership()],
        activeContext: testActiveContext(),
        ...overrides,
    });
}
