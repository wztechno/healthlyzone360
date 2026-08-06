import { BranchId, MembershipId, OrganisationId, UserId } from '@healthy360/domain-types';

/**
 * Deterministic identifiers for the platform administration mock world (PA1).
 *
 * Same discipline as `../kitchen-ops/ids.ts`: a fixed UUIDv7 prefix and a two-hex-digit band per
 * entity type, so an identifier read off a failing assertion says what it points at without a
 * lookup. The prefix is `01935f6f-…` — one past the kitchen-ops world's `01935f6e-…` — so this
 * world is provably disjoint from every other mock band.
 *
 * The kitchens deliberately do **not** reuse `MOCK_ORGANISATION_IDS.verdantKitchen` from
 * `../ids.ts`. That identifier belongs to the session fixture world, where Verdant is the
 * organisation the signed-in kitchen owner works in; here it would be a row in somebody else's
 * console, and one identifier meaning both things is how a test comes to assert against the wrong
 * screen.
 */
export const PLATFORM_ADMIN_ID_PREFIX = '01935f6f-0000-7000-8000-';

export const PLATFORM_ADMIN_ID_BANDS = {
    kitchen: 'a0',
    membership: 'b0',
    branch: 'c0',
    user: 'd0',
    invitation: 'e0',
} as const;

export type PlatformAdminIdBand = keyof typeof PLATFORM_ADMIN_ID_BANDS;

export const PLATFORM_ADMIN_ORDINAL_LIMIT = 0xff;

export function platformAdminId(band: PlatformAdminIdBand, ordinal: number): string {
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > PLATFORM_ADMIN_ORDINAL_LIMIT) {
        throw new RangeError(
            `Platform admin ordinal ${String(ordinal)} is outside the ${band} band (0–${String(PLATFORM_ADMIN_ORDINAL_LIMIT)}).`,
        );
    }
    const suffix = ordinal.toString(16).padStart(2, '0');
    return `${PLATFORM_ADMIN_ID_PREFIX}00000000${PLATFORM_ADMIN_ID_BANDS[band]}${suffix}`;
}

export const kitchenIdAt = (ordinal: number): OrganisationId =>
    OrganisationId.unsafe(platformAdminId('kitchen', ordinal));
export const membershipIdAt = (ordinal: number): MembershipId =>
    MembershipId.unsafe(platformAdminId('membership', ordinal));
export const branchIdAt = (ordinal: number): BranchId =>
    BranchId.unsafe(platformAdminId('branch', ordinal));
export const ownerUserIdAt = (ordinal: number): UserId =>
    UserId.unsafe(platformAdminId('user', ordinal));
export const invitationIdAt = (ordinal: number): string => platformAdminId('invitation', ordinal);

/**
 * Where the store starts minting identifiers for rows a *person* creates in the running session.
 * Fixtures occupy the low ordinals; runtime rows occupy `0x80` upwards, the same convention every
 * other mock world here uses.
 */
export const PLATFORM_ADMIN_RUNTIME_ORDINAL_START = 0x80;
