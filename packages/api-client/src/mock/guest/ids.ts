import { OrderId } from '@healthy360/domain-types';

/**
 * Deterministic identifiers for the G1 guest world.
 *
 * Same discipline as `../ids.ts`, `../prototype/ids.ts` and `../account/ids.ts`: a fixed UUIDv7
 * prefix and a band per entity type, so an identifier read off a failing assertion says what it
 * points at without a lookup.
 *
 * The prefix is `01935f6f-…` — one greater than the account world's `01935f6e-…` — so the four
 * fixture worlds are provably disjoint. The **bands are `60`–`64`**, which leaves every earlier
 * world's range untouched.
 */
export const GUEST_ID_PREFIX = '01935f6f-0000-7000-8000-';

export const GUEST_ID_BANDS = {
    guestSession: '60',
    guestContact: '61',
    guestChallenge: '62',
    guestOrder: '63',
    guestOrderLine: '64',
} as const;

export type GuestIdBand = keyof typeof GUEST_ID_BANDS;

export const GUEST_ID_BAND_NAMES = Object.keys(GUEST_ID_BANDS) as readonly GuestIdBand[];

/** The largest ordinal a band can carry. Two hex digits: 0–255 rows per entity type. */
export const GUEST_ORDINAL_LIMIT = 0xff;

export class GuestIdRangeError extends RangeError {
    constructor(band: GuestIdBand, ordinal: number) {
        super(
            `Guest ordinal ${String(ordinal)} is outside the ${band} band. ` +
                `Ordinals are a single byte (0–${GUEST_ORDINAL_LIMIT}).`,
        );
        this.name = 'GuestIdRangeError';
    }
}

/** `01935f6f-0000-7000-8000-00000000<band><ordinal>`. */
export function guestId(band: GuestIdBand, ordinal: number): string {
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > GUEST_ORDINAL_LIMIT) {
        throw new GuestIdRangeError(band, ordinal);
    }
    return `${GUEST_ID_PREFIX}00000000${GUEST_ID_BANDS[band]}${ordinal.toString(16).padStart(2, '0')}`;
}

export const guestSessionIdAt = (ordinal: number): string => guestId('guestSession', ordinal);
export const guestContactIdAt = (ordinal: number): string => guestId('guestContact', ordinal);
export const guestChallengeIdAt = (ordinal: number): string => guestId('guestChallenge', ordinal);
export const guestOrderIdAt = (ordinal: number): OrderId =>
    OrderId.unsafe(guestId('guestOrder', ordinal));
export const guestOrderLineIdAt = (ordinal: number): string => guestId('guestOrderLine', ordinal);

/**
 * The guest token, deterministically.
 *
 * Opaque and fixed-shape, exactly like the backend's 48-byte credential is opaque — but *derived*
 * rather than random, because a Playwright spec that has to read a token off a network response to
 * continue is a spec that cannot assert on it. It is prefixed so that a token appearing anywhere it
 * should not — a log line, a URL, a query key — is greppable.
 */
export const guestTokenAt = (ordinal: number): string =>
    `gst_${GUEST_ID_PREFIX.slice(0, 8)}${ordinal.toString(16).padStart(8, '0')}`;

/**
 * The human-quotable order reference.
 *
 * Deliberately not the identifier: a person reads this over a phone, and a UUID is not something
 * anybody reads over a phone. Sequential in the mock so a test can name one; the real generator is
 * not, because a guessable reference is an order somebody else can look up.
 */
export const guestOrderReferenceAt = (ordinal: number): string =>
    `H360-G${(1000 + ordinal).toString(10)}`;

/** Where the store starts minting identifiers for rows a *person* creates. */
export const GUEST_RUNTIME_ORDINAL_START = 0x10;
