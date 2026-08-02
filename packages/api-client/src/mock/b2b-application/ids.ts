/**
 * Deterministic identifiers for the B1 B2B-onboarding world.
 *
 * Same discipline as `../ids.ts`, `../prototype/ids.ts` and `../account/ids.ts`: a fixed UUIDv7
 * prefix and a band per entity type, so an identifier read off a failing assertion says what it
 * points at without a lookup. Nothing here is random.
 *
 * The prefix is `01935f6f-…` — one greater than the account world's `01935f6e-…` — so the four
 * fixture worlds are provably disjoint. The **bands are `60`–`64`**, above the account world's
 * `50`–`58` reservation, which leaves every existing band untouched.
 */
export const B2B_ID_PREFIX = '01935f6f-0000-7000-8000-';

/** Two hex digits per entity type, occupying byte 5 of the final UUID group. */
export const B2B_ID_BANDS = {
    application: '60',
    document: '61',
    agreement: '62',
    reviewerRequest: '63',
    organisation: '64',
} as const;

export type B2bIdBand = keyof typeof B2B_ID_BANDS;

export const B2B_ID_BAND_NAMES = Object.keys(B2B_ID_BANDS) as readonly B2bIdBand[];

/** The largest ordinal a band can carry. Two hex digits: 0–255 rows per entity type. */
export const B2B_ORDINAL_LIMIT = 0xff;

export class B2bIdRangeError extends RangeError {
    constructor(band: B2bIdBand, ordinal: number) {
        super(
            `B2B ordinal ${String(ordinal)} is outside the ${band} band. ` +
                `Ordinals are a single byte (0–${B2B_ORDINAL_LIMIT}).`,
        );
        this.name = 'B2bIdRangeError';
    }
}

/** `01935f6f-0000-7000-8000-00000000<band><ordinal>`. */
export function b2bId(band: B2bIdBand, ordinal: number): string {
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > B2B_ORDINAL_LIMIT) {
        throw new B2bIdRangeError(band, ordinal);
    }
    return `${B2B_ID_PREFIX}00000000${B2B_ID_BANDS[band]}${ordinal.toString(16).padStart(2, '0')}`;
}

export const applicationIdAt = (ordinal: number): string => b2bId('application', ordinal);
export const documentIdAt = (ordinal: number): string => b2bId('document', ordinal);
export const agreementIdAt = (ordinal: number): string => b2bId('agreement', ordinal);
export const reviewerRequestIdAt = (ordinal: number): string => b2bId('reviewerRequest', ordinal);
export const organisationIdAt = (ordinal: number): string => b2bId('organisation', ordinal);

/**
 * Where the store starts minting identifiers for rows a *person* creates — an uploaded document, a
 * replacement, an application started from the entry screen.
 *
 * Fixtures occupy the low ordinals; runtime rows occupy `0x80` upwards, so a failing test can tell
 * "this came from the seed" from "this was created by the interaction under test" from the
 * identifier alone.
 */
export const B2B_RUNTIME_ORDINAL_START = 0x80;
