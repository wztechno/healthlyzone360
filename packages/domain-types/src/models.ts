import type { BranchId, DeviceId, MembershipId, OrganisationId, RoleId, UserId } from './ids.ts';
import type { Locale, MembershipStatus } from './enums.ts';

/**
 * Foundation domain shapes (plan §7, §9). These describe what the frontend needs from
 * `/api/v1/me` and `/api/v1/me/memberships`; they are hand-written for Phase 5a and will be
 * reconciled against the generated OpenAPI schemas in 5c, at which point the generated types
 * become authoritative and these become the repository-layer view model.
 *
 * Timestamps are ISO-8601 strings, not `Date`, so the shapes stay serialisable and comparable.
 */
export type IsoDateTime = string;

export interface Profile {
    readonly userId: UserId;
    readonly displayName: string;
    readonly givenName: string | null;
    readonly familyName: string | null;
    readonly avatarUrl: string | null;
    readonly preferredLocale: Locale;
    readonly timeZone: string | null;
}

export interface SessionUser {
    readonly id: UserId;
    readonly email: string;
    readonly emailVerifiedAt: IsoDateTime | null;
    readonly twoFactorEnabled: boolean;
    readonly profile: Profile;
    readonly createdAt: IsoDateTime;
}

export interface Organisation {
    readonly id: OrganisationId;
    readonly name: string;
    readonly slug: string;
    /** `organisation_types.code`, e.g. `clinic`, `kitchen`, `corporate`. */
    readonly type: string;
    readonly countryCode: string;
    readonly defaultLocale: Locale;
    readonly isActive: boolean;
}

export interface Branch {
    readonly id: BranchId;
    readonly organisationId: OrganisationId;
    readonly name: string;
    readonly code: string;
    readonly countryCode: string;
    readonly timeZone: string;
    readonly isActive: boolean;
}

export interface MembershipRole {
    readonly id: RoleId;
    readonly key: string;
    readonly name: string;
}

export interface Membership {
    readonly id: MembershipId;
    readonly userId: UserId;
    readonly organisation: Organisation;
    readonly status: MembershipStatus;
    readonly roles: readonly MembershipRole[];
    /** Empty means the membership is organisation-wide rather than branch-scoped. */
    readonly branches: readonly Branch[];
    readonly startsAt: IsoDateTime | null;
    readonly expiresAt: IsoDateTime | null;
}

export interface Device {
    readonly id: DeviceId;
    readonly userId: UserId;
    readonly name: string;
    readonly platform: 'ios' | 'android' | 'web';
    readonly lastUsedAt: IsoDateTime | null;
    readonly isCurrent: boolean;
}

/**
 * The server-validated context a request is executed in (plan §9). The client may *propose* a
 * context via `PUT /api/v1/me/context`, but only the server's echo is trusted.
 */
export interface ActiveContext {
    readonly organisationId: OrganisationId | null;
    readonly branchId: BranchId | null;
    readonly membershipId: MembershipId | null;
    readonly permissions: readonly string[];
    readonly entitlements: readonly string[];
    /** Bumped by the backend permission-version counter; invalidates cached permission sets. */
    readonly permissionVersion: number;
}
