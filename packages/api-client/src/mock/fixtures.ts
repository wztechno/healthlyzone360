import type {
    Branch,
    Device,
    Locale,
    Membership,
    MembershipRole,
    MembershipStatus,
    Organisation,
    OrganisationId,
    Profile,
    SessionUser,
    UserId,
} from '@healthy360/domain-types';

import type { PendingConsent } from '../contracts/session.ts';
import { MOCK_BRANCH_IDS, MOCK_DEVICE_IDS, MOCK_ORGANISATION_IDS, MOCK_ROLE_IDS } from './ids.ts';

/**
 * The fixture vocabulary the mock scenarios are assembled from.
 *
 * The organisations mirror the backend demo tenants so that a journey rehearsed against the mock
 * reads identically against the seeded API in 5c: **Cedar Clinic** (Hamra, Jounieh — Lebanon) and
 * **Verdant Kitchen** (Al Quoz — United Arab Emirates).
 */

/** Every timestamp in the store is derived from this instant. */
export const MOCK_NOW = '2026-07-30T09:00:00.000Z';
export const MOCK_CREATED_AT = '2025-09-01T08:00:00.000Z';
export const MOCK_VERIFIED_AT = '2025-09-01T08:15:00.000Z';

/** The one password every demo account accepts. */
export const MOCK_PASSWORD = 'password';

/** Role → permission keys (`domain.action_scope`, plan §10). Allow-based; no deny rules. */
export const MOCK_ROLE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
    organisation_owner: [
        'organisation.view_current',
        'organisation.manage_current',
        'branch.view_current',
        'branch.manage_current',
        'membership.view_organisation',
        'membership.invite_organisation',
        'user.manage_organisation',
        'device.manage_own',
        'session.revoke_own',
    ],
    clinic_dietitian: [
        'organisation.view_current',
        'branch.view_current',
        'membership.view_organisation',
        'device.manage_own',
        'session.revoke_own',
    ],
    clinic_receptionist: [
        'organisation.view_current',
        'branch.view_current',
        'device.manage_own',
        'session.revoke_own',
    ],
    /**
     * The kitchen workspace role (K1).
     *
     * `catalogue.view_organisation` / `catalogue.manage_organisation` are the first two codes of the
     * phase's `catalogue.*_organisation` set (master plan, phase K1 "Permissions"). They are granted
     * on this role rather than on a bespoke one because Verdant Kitchen's manager is exactly the
     * person the kitchen admin area is for, and inventing a second kitchen role would make the mock
     * world disagree with the backend template roles it mirrors.
     */
    kitchen_manager: [
        'organisation.view_current',
        'branch.view_current',
        'branch.manage_current',
        'catalogue.view_organisation',
        'catalogue.manage_organisation',
        'device.manage_own',
        'session.revoke_own',
    ],
    platform_administrator: [
        'platform.access_admin',
        'organisation.view_current',
        'branch.view_current',
        'membership.view_organisation',
        'device.manage_own',
        'session.revoke_own',
    ],
};

/**
 * Permissions a user holds on their *global* identity, outside any organisation (plan §9). This is
 * what a consumer with no membership signs in with, and it is why the customer areas need no
 * organisation context (decision D1).
 */
export const MOCK_GLOBAL_PERMISSIONS: readonly string[] = [
    'device.manage_own',
    'session.revoke_own',
];

/**
 * Feature entitlements per organisation. Only the four codes the backend actually seeds appear
 * here (decision D2) — no area is gated on them; they exist so the gate stays exercised end to end.
 */
export const MOCK_ORGANISATION_ENTITLEMENTS: Readonly<Record<string, readonly string[]>> = {
    [MOCK_ORGANISATION_IDS.cedarClinic]: ['feature.multi_branch', 'feature.audit_export'],
    [MOCK_ORGANISATION_IDS.verdantKitchen]: ['feature.multi_branch', 'feature.api_access'],
};

export const MOCK_ROLES: Readonly<Record<string, MembershipRole>> = {
    clinic_dietitian: {
        id: MOCK_ROLE_IDS.clinicDietitian,
        key: 'clinic_dietitian',
        name: 'Clinic dietitian',
    },
    organisation_owner: {
        id: MOCK_ROLE_IDS.organisationOwner,
        key: 'organisation_owner',
        name: 'Organisation owner',
    },
    kitchen_manager: {
        id: MOCK_ROLE_IDS.kitchenManager,
        key: 'kitchen_manager',
        name: 'Kitchen manager',
    },
    platform_administrator: {
        id: MOCK_ROLE_IDS.platformAdministrator,
        key: 'platform_administrator',
        name: 'Platform administrator',
    },
    clinic_receptionist: {
        id: MOCK_ROLE_IDS.clinicReceptionist,
        key: 'clinic_receptionist',
        name: 'Clinic receptionist',
    },
};

export const CEDAR_CLINIC: Organisation = {
    id: MOCK_ORGANISATION_IDS.cedarClinic,
    name: 'Cedar Clinic',
    slug: 'cedar-clinic',
    type: 'clinic',
    countryCode: 'LB',
    defaultLocale: 'en',
    isActive: true,
};

export const VERDANT_KITCHEN: Organisation = {
    id: MOCK_ORGANISATION_IDS.verdantKitchen,
    name: 'Verdant Kitchen',
    slug: 'verdant-kitchen',
    type: 'kitchen',
    countryCode: 'AE',
    defaultLocale: 'ar',
    isActive: true,
};

export const HAMRA_BRANCH: Branch = {
    id: MOCK_BRANCH_IDS.hamra,
    organisationId: MOCK_ORGANISATION_IDS.cedarClinic,
    name: 'Hamra',
    code: 'BEY-HAM',
    countryCode: 'LB',
    timeZone: 'Asia/Beirut',
    isActive: true,
};

export const JOUNIEH_BRANCH: Branch = {
    id: MOCK_BRANCH_IDS.jounieh,
    organisationId: MOCK_ORGANISATION_IDS.cedarClinic,
    name: 'Jounieh',
    code: 'BEY-JOU',
    countryCode: 'LB',
    timeZone: 'Asia/Beirut',
    isActive: true,
};

export const AL_QUOZ_BRANCH: Branch = {
    id: MOCK_BRANCH_IDS.alQuoz,
    organisationId: MOCK_ORGANISATION_IDS.verdantKitchen,
    name: 'Al Quoz',
    code: 'DXB-AQZ',
    countryCode: 'AE',
    timeZone: 'Asia/Dubai',
    isActive: true,
};

export const MOCK_ORGANISATIONS: readonly Organisation[] = [CEDAR_CLINIC, VERDANT_KITCHEN];
export const MOCK_BRANCHES: readonly Branch[] = [HAMRA_BRANCH, JOUNIEH_BRANCH, AL_QUOZ_BRANCH];

interface MakeUserOptions {
    readonly id: UserId;
    readonly email: string;
    readonly displayName: string;
    readonly givenName: string;
    readonly familyName: string;
    readonly locale?: Locale | undefined;
    readonly timeZone?: string | undefined;
    readonly verified?: boolean | undefined;
    readonly twoFactorEnabled?: boolean | undefined;
}

export function makeMockUser(options: MakeUserOptions): SessionUser {
    const profile: Profile = {
        userId: options.id,
        displayName: options.displayName,
        givenName: options.givenName,
        familyName: options.familyName,
        avatarUrl: null,
        preferredLocale: options.locale ?? 'en',
        timeZone: options.timeZone ?? 'Asia/Beirut',
    };

    return {
        id: options.id,
        email: options.email,
        emailVerifiedAt: options.verified === false ? null : MOCK_VERIFIED_AT,
        twoFactorEnabled: options.twoFactorEnabled === true,
        profile,
        createdAt: MOCK_CREATED_AT,
    };
}

interface MakeMembershipOptions {
    readonly id: Membership['id'];
    readonly userId: UserId;
    readonly organisation: Organisation;
    readonly roleKeys: readonly string[];
    readonly branches: readonly Branch[];
    readonly status?: MembershipStatus | undefined;
}

export function makeMockMembership(options: MakeMembershipOptions): Membership {
    return {
        id: options.id,
        userId: options.userId,
        organisation: options.organisation,
        status: options.status ?? 'active',
        roles: options.roleKeys.map((key) => {
            const role = MOCK_ROLES[key];
            if (role === undefined) throw new Error(`Unknown mock role "${key}"`);
            return role;
        }),
        branches: [...options.branches],
        startsAt: MOCK_CREATED_AT,
        expiresAt: null,
    };
}

export function makeMockDevices(userId: UserId): readonly Device[] {
    return [
        {
            id: MOCK_DEVICE_IDS.laptop,
            userId,
            name: 'Chrome on Windows',
            platform: 'web',
            lastUsedAt: MOCK_NOW,
            isCurrent: true,
        },
        {
            id: MOCK_DEVICE_IDS.phone,
            userId,
            name: 'iPhone 16',
            platform: 'ios',
            lastUsedAt: '2026-07-28T18:42:00.000Z',
            isCurrent: false,
        },
        {
            id: MOCK_DEVICE_IDS.tablet,
            userId,
            name: 'Galaxy Tab S10',
            platform: 'android',
            lastUsedAt: '2026-07-11T07:05:00.000Z',
            isCurrent: false,
        },
    ];
}

export const MOCK_PENDING_CONSENT: PendingConsent = {
    code: 'marketing_updates',
    version: '2026-01',
    required: false,
    publishedAt: '2026-01-05T00:00:00.000Z',
};

/** Effective permission keys for a membership, unioned across its roles. */
export function permissionsForMembership(membership: Membership): readonly string[] {
    const keys = new Set<string>(MOCK_GLOBAL_PERMISSIONS);
    for (const role of membership.roles) {
        for (const key of MOCK_ROLE_PERMISSIONS[role.key] ?? []) keys.add(key);
    }
    return [...keys].sort();
}

export function entitlementsForOrganisation(organisationId: OrganisationId): readonly string[] {
    return MOCK_ORGANISATION_ENTITLEMENTS[organisationId] ?? [];
}
