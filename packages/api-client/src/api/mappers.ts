import {
    BranchId,
    DeviceId,
    MembershipId,
    OrganisationId,
    RoleId,
    UserId,
    isLocale,
} from '@healthy360/domain-types';
import type {
    ActiveContext,
    Branch,
    Device,
    Locale,
    Membership,
    MembershipRole,
    MembershipStatus,
    Organisation,
    Profile,
    SessionUser,
} from '@healthy360/domain-types';

import type { MeResponse, PendingConsent } from '../contracts/session.ts';
import type {
    ActiveContext as WireActiveContext,
    Branch as WireBranch,
    Device as WireDevice,
    Membership as WireMembership,
    Organisation as WireOrganisation,
    PendingConsent as WirePendingConsent,
    Profile as WireProfile,
    User as WireUser,
} from '../generated/types.ts';

/**
 * Wire (`snake_case`, OpenAPI) → domain (`camelCase`, `@healthy360/domain-types`).
 *
 * The two are not isomorphic, and the gaps are recorded here rather than papered over:
 *
 * | domain field                 | wire source                        | note |
 * |------------------------------|------------------------------------|------|
 * | `SessionUser.emailVerifiedAt`| `user.email_verified` (boolean)    | see `EMAIL_VERIFIED_AT_UNKNOWN` |
 * | `SessionUser.createdAt`      | *(absent)*                         | `UNKNOWN_ISO_DATE_TIME` |
 * | `Profile.avatarUrl`          | *(absent)*                         | `null`; there are no avatars yet |
 * | `Profile.displayName`        | `given_name` + `family_name`       | the API has no display-name concept |
 * | `MembershipRole.id`/`name`   | `roles[]` (codes only)             | the code is the identity and the label |
 * | `Membership.branches`        | `branch_id` + hydrated contexts    | see `BranchDirectory` |
 * | `Membership.expiresAt`       | *(absent)*                         | `null`; the API never lists an ended membership |
 * | `Branch.code`/`countryCode`  | *(absent)*                         | `''`; only `name`, `city`, `timezone`, `status` are on the wire |
 * | `ActiveContext.permissionVersion` | `/me` `meta.permissions_version` | an opaque string; see `parsePermissionsVersion` |
 *
 * Each of those is a genuine hole in `GET /api/v1/me`, not a mapping choice. They are listed in the
 * phase report as backend follow-ups; nothing here invents a value that could be mistaken for one.
 */

/**
 * The wire says *whether* the address is verified, never *when*.
 *
 * `SessionUser.emailVerifiedAt` is read as a boolean everywhere it is read (the session machine,
 * the access-state projection, the verification screen) and rendered nowhere, so a sentinel is
 * safe. The epoch is used deliberately: if it ever does reach a screen it reads as obviously
 * unknown rather than as a plausible date.
 */
export const EMAIL_VERIFIED_AT_UNKNOWN = '1970-01-01T00:00:00.000Z';

/** A timestamp the API does not expose. Screens must render it as "unknown", never format it. */
export const UNKNOWN_ISO_DATE_TIME = '';

export function mapLocale(code: string | null | undefined): Locale {
    return isLocale(code) ? code : 'en';
}

/** Wire membership statuses are a subset; `invited` is the domain's `pending`. */
export function mapMembershipStatus(status: WireMembership['status']): MembershipStatus {
    return status === 'invited' ? 'pending' : status;
}

export function mapOrganisation(wire: WireOrganisation): Organisation {
    return {
        id: OrganisationId.unsafe(wire.id),
        name: wire.name,
        slug: wire.slug,
        type: wire.type ?? '',
        countryCode: wire.country_code,
        defaultLocale: mapLocale(wire.default_language_code),
        isActive: wire.status === 'active',
    };
}

export function mapBranch(wire: WireBranch, organisationId: OrganisationId): Branch {
    return {
        id: BranchId.unsafe(wire.id),
        organisationId,
        name: wire.name,
        // The API exposes no branch code; the city is the only other human label it carries, and
        // the picker's `description` reads "<code> · <timezone>". An empty code is honest.
        code: '',
        countryCode: '',
        timeZone: wire.timezone,
        isActive: wire.status === 'active',
    };
}

/**
 * Branches the client has actually been shown, keyed by identifier.
 *
 * `GET /me` gives a membership's `branch_id` but no branch directory, and there is no endpoint that
 * lists an organisation's branches — so the only hydrated `Branch` a client ever sees is the one
 * inside an `active_context`. Remembering those lets the profile screen name the current branch
 * instead of printing "no branch" next to a context that plainly has one.
 *
 * It never manufactures a branch: an id with no hydrated record simply does not appear in
 * `Membership.branches`, which keeps `membershipRequiresBranchSelection` (`branches.length > 1`)
 * honest — the client cannot offer a choice it has no data for.
 */
export interface BranchDirectory {
    remember(branch: Branch): void;
    get(id: string): Branch | undefined;
}

export function createBranchDirectory(): BranchDirectory {
    const branches = new Map<string, Branch>();
    return {
        remember: (branch) => {
            branches.set(branch.id, branch);
        },
        get: (id) => branches.get(id),
    };
}

export function mapMembershipRole(code: string): MembershipRole {
    // The wire carries role *codes*; the platform's role identifiers are never exposed. The code is
    // therefore both the identity and the label — `RoleId.unsafe` exists for exactly this boundary.
    return { id: RoleId.unsafe(code), key: code, name: code };
}

export function mapMembership(
    wire: WireMembership,
    userId: UserId,
    branches: BranchDirectory,
): Membership {
    const organisation = mapOrganisation(wire.organisation);
    const scopedBranch = wire.branch_id === null ? undefined : branches.get(wire.branch_id);

    return {
        id: MembershipId.unsafe(wire.id),
        userId,
        organisation,
        status: mapMembershipStatus(wire.status),
        roles: wire.roles.map(mapMembershipRole),
        branches: scopedBranch === undefined ? [] : [scopedBranch],
        startsAt: wire.joined_at,
        expiresAt: null,
    };
}

export function mapProfile(wire: WireProfile, user: WireUser): Profile {
    const userId = UserId.unsafe(user.id);
    if (wire === null) {
        // A profile is created with the account, so this is a defensive branch rather than an
        // expected one. Falling back to the address beats rendering an empty card.
        return {
            userId,
            displayName: user.email,
            givenName: null,
            familyName: null,
            avatarUrl: null,
            preferredLocale: 'en',
            timeZone: null,
        };
    }

    const displayName = `${wire.given_name} ${wire.family_name}`.trim();
    return {
        userId,
        displayName: displayName === '' ? user.email : displayName,
        givenName: wire.given_name,
        familyName: wire.family_name,
        avatarUrl: null,
        preferredLocale: mapLocale(wire.preferred_language_code),
        timeZone: wire.timezone,
    };
}

export function mapUser(wire: WireUser, profile: Profile): SessionUser {
    return {
        id: UserId.unsafe(wire.id),
        email: wire.email,
        emailVerifiedAt: wire.email_verified ? EMAIL_VERIFIED_AT_UNKNOWN : null,
        twoFactorEnabled: wire.two_factor_enabled,
        profile,
        createdAt: UNKNOWN_ISO_DATE_TIME,
    };
}

export function mapDevice(wire: WireDevice, userId: UserId): Device {
    return {
        id: DeviceId.unsafe(wire.id),
        userId,
        name: wire.device_name,
        platform: wire.platform,
        lastUsedAt: wire.last_seen_at,
        isCurrent: wire.is_current,
    };
}

export function mapPendingConsent(wire: WirePendingConsent): PendingConsent {
    return {
        code: wire.code,
        version: String(wire.version),
        // The wire does not mark a consent as blocking; the platform consents seeded today are all
        // required, but claiming that from the client would be guessing. Phase 1 only surfaces
        // *that* something is outstanding (contracts/session.ts).
        required: false,
        publishedAt: UNKNOWN_ISO_DATE_TIME,
    };
}

/**
 * `meta.permissions_version` is an opaque stamp such as `"53.0"` — the platform and organisation
 * permission counters joined by a dot. `ActiveContext.permissionVersion` is typed `number`, which
 * predates that stamp, so it is parsed as a float: monotonic enough to invalidate a cache, and
 * nothing reads it today. Widening the domain type to `string` is a `domain-types` follow-up.
 */
export function parsePermissionsVersion(raw: string | null): number {
    if (raw === null) return 0;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function mapActiveContext(
    wire: WireActiveContext,
    permissionVersion: number,
    branches: BranchDirectory,
): ActiveContext | null {
    if (wire === null) return null;

    const organisationId = OrganisationId.unsafe(wire.organisation.id);
    if (wire.branch !== null) branches.remember(mapBranch(wire.branch, organisationId));

    return {
        organisationId,
        branchId: wire.branch === null ? null : BranchId.unsafe(wire.branch.id),
        membershipId: MembershipId.unsafe(wire.membership_id),
        permissions: wire.permissions,
        entitlements: wire.entitlements,
        permissionVersion,
    };
}

export interface WireMePayload {
    readonly user: WireUser;
    readonly profile: WireProfile;
    readonly memberships: readonly WireMembership[];
    readonly active_context: WireActiveContext;
    readonly pending_consents: readonly WirePendingConsent[];
}

/**
 * `GET /api/v1/me` → `MeResponse`.
 *
 * The active context is mapped **first**, so the branch it hydrates is already in the directory
 * when the memberships that reference it are mapped.
 */
export function mapMeResponse(
    payload: WireMePayload,
    permissionsVersion: string | null,
    branches: BranchDirectory,
): MeResponse {
    const activeContext = mapActiveContext(
        payload.active_context,
        parsePermissionsVersion(permissionsVersion),
        branches,
    );
    const profile = mapProfile(payload.profile, payload.user);
    const user = mapUser(payload.user, profile);

    return {
        user,
        profile,
        memberships: payload.memberships.map((membership) =>
            mapMembership(membership, user.id, branches),
        ),
        activeContext,
        pendingConsents: payload.pending_consents.map(mapPendingConsent),
    };
}
