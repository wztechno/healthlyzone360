import {
    BranchId,
    DeviceId,
    MembershipId,
    OrganisationId,
    RoleId,
    UserId,
} from '@healthy360/domain-types';

/**
 * Deterministic identifiers for the mock fixture store.
 *
 * Same convention as `@healthy360/testing`'s `FIXTURE_IDS`: a fixed UUIDv7 prefix and a
 * human-readable suffix band per entity type (`…01xx` users, `…a1xx` organisations, `…b1xx`
 * memberships, `…c1xx` branches, `…d1xx` roles, `…e1xx` devices). Nothing here is random —
 * a failing Playwright assertion has to be reproducible from its message alone.
 *
 * The 1xx band deliberately does not collide with the 0xx band used by `@healthy360/testing`, so a
 * test can hold both a unit fixture and a mock-store record without ambiguity.
 */
const PREFIX = '01935f6c-0000-7000-8000-';
const id = (suffix: string) => `${PREFIX}${suffix}`;

export const MOCK_USER_IDS = {
    dietitian: UserId.unsafe(id('000000000101')),
    owner: UserId.unsafe(id('000000000102')),
    consumer: UserId.unsafe(id('000000000103')),
    unverified: UserId.unsafe(id('000000000104')),
    twoFactor: UserId.unsafe(id('000000000105')),
    platformAdmin: UserId.unsafe(id('000000000106')),
} as const;

export const MOCK_ORGANISATION_IDS = {
    cedarClinic: OrganisationId.unsafe(id('00000000a101')),
    verdantKitchen: OrganisationId.unsafe(id('00000000a102')),
} as const;

export const MOCK_BRANCH_IDS = {
    hamra: BranchId.unsafe(id('00000000c101')),
    jounieh: BranchId.unsafe(id('00000000c102')),
    alQuoz: BranchId.unsafe(id('00000000c103')),
} as const;

export const MOCK_MEMBERSHIP_IDS = {
    dietitianClinic: MembershipId.unsafe(id('00000000b101')),
    dietitianKitchen: MembershipId.unsafe(id('00000000b102')),
    ownerClinic: MembershipId.unsafe(id('00000000b103')),
    unverifiedClinic: MembershipId.unsafe(id('00000000b104')),
    twoFactorClinic: MembershipId.unsafe(id('00000000b105')),
    platformAdminClinic: MembershipId.unsafe(id('00000000b106')),
    dietitianPendingCorporate: MembershipId.unsafe(id('00000000b107')),
} as const;

export const MOCK_ROLE_IDS = {
    clinicDietitian: RoleId.unsafe(id('00000000d101')),
    organisationOwner: RoleId.unsafe(id('00000000d102')),
    kitchenManager: RoleId.unsafe(id('00000000d103')),
    platformAdministrator: RoleId.unsafe(id('00000000d104')),
    clinicReceptionist: RoleId.unsafe(id('00000000d105')),
} as const;

export const MOCK_DEVICE_IDS = {
    laptop: DeviceId.unsafe(id('00000000e101')),
    phone: DeviceId.unsafe(id('00000000e102')),
    tablet: DeviceId.unsafe(id('00000000e103')),
} as const;
