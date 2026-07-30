import {
    BranchId,
    DeviceId,
    MembershipId,
    OrganisationId,
    RoleId,
    UserId,
} from '@healthy360/domain-types';
import type {
    ActiveContext,
    Branch,
    Device,
    Membership,
    MembershipRole,
    Organisation,
    Profile,
    SessionUser,
} from '@healthy360/domain-types';

/**
 * Deterministic fixture factories.
 *
 * Every identifier and timestamp below is a fixed constant. Randomised fixtures make failures
 * irreproducible from the assertion message, so they are banned here.
 */
export const FIXTURE_IDS = {
    user: UserId.unsafe('01935f6c-0000-7000-8000-000000000091'),
    otherUser: UserId.unsafe('01935f6c-0000-7000-8000-000000000092'),
    organisation: OrganisationId.unsafe('01935f6c-0000-7000-8000-00000000a001'),
    otherOrganisation: OrganisationId.unsafe('01935f6c-0000-7000-8000-00000000a002'),
    membership: MembershipId.unsafe('01935f6c-0000-7000-8000-00000000b001'),
    branch: BranchId.unsafe('01935f6c-0000-7000-8000-00000000c001'),
    otherBranch: BranchId.unsafe('01935f6c-0000-7000-8000-00000000c002'),
    role: RoleId.unsafe('01935f6c-0000-7000-8000-00000000d001'),
    device: DeviceId.unsafe('01935f6c-0000-7000-8000-00000000e001'),
} as const;

/** A single frozen instant used by every fixture that needs a timestamp. */
export const FIXTURE_NOW = '2026-01-15T09:30:00.000Z';
export const FIXTURE_CREATED_AT = '2025-11-01T08:00:00.000Z';

export function makeProfile(overrides: Partial<Profile> = {}): Profile {
    return {
        userId: FIXTURE_IDS.user,
        displayName: 'Layla Haddad',
        givenName: 'Layla',
        familyName: 'Haddad',
        avatarUrl: null,
        preferredLocale: 'en',
        timeZone: 'Asia/Beirut',
        ...overrides,
    };
}

export function makeSessionUser(overrides: Partial<SessionUser> = {}): SessionUser {
    return {
        id: FIXTURE_IDS.user,
        email: 'layla.haddad@example.com',
        emailVerifiedAt: FIXTURE_CREATED_AT,
        twoFactorEnabled: false,
        profile: makeProfile(),
        createdAt: FIXTURE_CREATED_AT,
        ...overrides,
    };
}

export function makeOrganisation(overrides: Partial<Organisation> = {}): Organisation {
    return {
        id: FIXTURE_IDS.organisation,
        name: 'Cedars Nutrition Clinic',
        slug: 'cedars-nutrition-clinic',
        type: 'clinic',
        countryCode: 'LB',
        defaultLocale: 'en',
        isActive: true,
        ...overrides,
    };
}

export function makeBranch(overrides: Partial<Branch> = {}): Branch {
    return {
        id: FIXTURE_IDS.branch,
        organisationId: FIXTURE_IDS.organisation,
        name: 'Beirut Central',
        code: 'BEY-01',
        countryCode: 'LB',
        timeZone: 'Asia/Beirut',
        isActive: true,
        ...overrides,
    };
}

export function makeMembershipRole(overrides: Partial<MembershipRole> = {}): MembershipRole {
    return {
        id: FIXTURE_IDS.role,
        key: 'clinic_dietitian',
        name: 'Clinic dietitian',
        ...overrides,
    };
}

export function makeMembership(overrides: Partial<Membership> = {}): Membership {
    return {
        id: FIXTURE_IDS.membership,
        userId: FIXTURE_IDS.user,
        organisation: makeOrganisation(),
        status: 'active',
        roles: [makeMembershipRole()],
        branches: [makeBranch()],
        startsAt: FIXTURE_CREATED_AT,
        expiresAt: null,
        ...overrides,
    };
}

export function makeDevice(overrides: Partial<Device> = {}): Device {
    return {
        id: FIXTURE_IDS.device,
        userId: FIXTURE_IDS.user,
        name: 'Layla’s iPhone',
        platform: 'ios',
        lastUsedAt: FIXTURE_NOW,
        isCurrent: true,
        ...overrides,
    };
}

export function makeActiveContext(overrides: Partial<ActiveContext> = {}): ActiveContext {
    return {
        organisationId: FIXTURE_IDS.organisation,
        branchId: FIXTURE_IDS.branch,
        membershipId: FIXTURE_IDS.membership,
        permissions: ['organisation.view_current', 'branch.view_current'],
        entitlements: ['module.clinic'],
        permissionVersion: 1,
        ...overrides,
    };
}
