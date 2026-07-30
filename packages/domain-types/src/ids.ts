import type { Brand } from './brand.ts';

/**
 * The platform issues UUIDv7 identifiers (plan §8). The codecs below validate the *shape* of an
 * identifier; they never generate one, because identifiers are always server-issued.
 */
export const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
    return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Reads the version nibble of a well-formed UUID (7 for UUIDv7). */
export function uuidVersion(value: string): number | null {
    if (!UUID_PATTERN.test(value)) return null;
    const nibble = value.charAt(14);
    const parsed = Number.parseInt(nibble, 16);
    return Number.isNaN(parsed) ? null : parsed;
}

export class InvalidIdentifierError extends Error {
    readonly label: string;
    readonly received: unknown;

    constructor(label: string, received: unknown) {
        super(`Invalid ${label}: expected a UUID string, received ${JSON.stringify(received)}`);
        this.name = 'InvalidIdentifierError';
        this.label = label;
        this.received = received;
    }
}

export interface IdCodec<T extends string> {
    /** Human-readable name, used in error messages and test output. */
    readonly label: string;
    /** Runtime guard: true when `value` is a UUID string. */
    is(value: unknown): value is T;
    /** Validates and brands. Throws `InvalidIdentifierError` when the shape is wrong. */
    parse(value: unknown): T;
    /** Validates and brands, returning `null` instead of throwing. */
    safeParse(value: unknown): T | null;
    /**
     * Brands without validating. Reserved for fixtures and for values that have already been
     * validated at a system boundary (e.g. the generated OpenAPI client).
     */
    unsafe(value: string): T;
}

function createIdCodec<T extends string>(label: string): IdCodec<T> {
    return {
        label,
        is(value: unknown): value is T {
            return isUuid(value);
        },
        parse(value: unknown): T {
            if (!isUuid(value)) throw new InvalidIdentifierError(label, value);
            return value as T;
        },
        safeParse(value: unknown): T | null {
            return isUuid(value) ? (value as T) : null;
        },
        unsafe(value: string): T {
            return value as T;
        },
    };
}

export type UserId = Brand<string, 'UserId'>;
export type OrganisationId = Brand<string, 'OrganisationId'>;
export type BranchId = Brand<string, 'BranchId'>;
export type MembershipId = Brand<string, 'MembershipId'>;
export type RoleId = Brand<string, 'RoleId'>;
export type DeviceId = Brand<string, 'DeviceId'>;

export const UserId: IdCodec<UserId> = createIdCodec<UserId>('UserId');
export const OrganisationId: IdCodec<OrganisationId> =
    createIdCodec<OrganisationId>('OrganisationId');
export const BranchId: IdCodec<BranchId> = createIdCodec<BranchId>('BranchId');
export const MembershipId: IdCodec<MembershipId> = createIdCodec<MembershipId>('MembershipId');
export const RoleId: IdCodec<RoleId> = createIdCodec<RoleId>('RoleId');
export const DeviceId: IdCodec<DeviceId> = createIdCodec<DeviceId>('DeviceId');

/** Every identifier codec, keyed by label — handy for table-driven tests. */
export const ID_CODECS = {
    UserId,
    OrganisationId,
    BranchId,
    MembershipId,
    RoleId,
    DeviceId,
} as const;

export type IdCodecName = keyof typeof ID_CODECS;
