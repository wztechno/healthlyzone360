import { IngredientId, ServiceAreaId } from '@healthy360/domain-types';

/**
 * Deterministic identifiers for the J1 account-and-verification world.
 *
 * Same discipline as `../ids.ts` and `../prototype/ids.ts`: a fixed UUIDv7 prefix and a band per
 * entity type, so an identifier read off a failing assertion says what it points at without a
 * lookup. Nothing here is random.
 *
 * The prefix is `01935f6e-…` — one greater than the prototype world's `01935f6d-…` — so the three
 * fixture worlds are provably disjoint. The **bands are `50`–`58`**, the range the plan reserves for
 * this phase (appendix E, mock world), which leaves the prototype's own bands untouched.
 */
export const ACCOUNT_ID_PREFIX = '01935f6e-0000-7000-8000-';

/** Two hex digits per entity type, occupying byte 5 of the final UUID group. */
export const ACCOUNT_ID_BANDS = {
    contactPoint: '50',
    otpChallenge: '51',
    customerAccount: '52',
    customerAddress: '53',
    serviceArea: '54',
    consentDefinition: '55',
    allergen: '56',
    dietCategory: '57',
    foodExclusion: '58',
} as const;

export type AccountIdBand = keyof typeof ACCOUNT_ID_BANDS;

export const ACCOUNT_ID_BAND_NAMES = Object.keys(ACCOUNT_ID_BANDS) as readonly AccountIdBand[];

/** The largest ordinal a band can carry. Two hex digits: 0–255 rows per entity type. */
export const ACCOUNT_ORDINAL_LIMIT = 0xff;

export class AccountIdRangeError extends RangeError {
    constructor(band: AccountIdBand, ordinal: number) {
        super(
            `Account ordinal ${String(ordinal)} is outside the ${band} band. ` +
                `Ordinals are a single byte (0–${ACCOUNT_ORDINAL_LIMIT}).`,
        );
        this.name = 'AccountIdRangeError';
    }
}

/** `01935f6e-0000-7000-8000-00000000<band><ordinal>`. */
export function accountId(band: AccountIdBand, ordinal: number): string {
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > ACCOUNT_ORDINAL_LIMIT) {
        throw new AccountIdRangeError(band, ordinal);
    }
    return `${ACCOUNT_ID_PREFIX}00000000${ACCOUNT_ID_BANDS[band]}${ordinal.toString(16).padStart(2, '0')}`;
}

export const contactPointIdAt = (ordinal: number): string => accountId('contactPoint', ordinal);
export const otpChallengeIdAt = (ordinal: number): string => accountId('otpChallenge', ordinal);
export const customerAccountIdAt = (ordinal: number): string =>
    accountId('customerAccount', ordinal);
export const customerAddressIdAt = (ordinal: number): string =>
    accountId('customerAddress', ordinal);
export const serviceAreaIdAt = (ordinal: number): ServiceAreaId =>
    ServiceAreaId.unsafe(accountId('serviceArea', ordinal));
export const foodExclusionIdAt = (ordinal: number): IngredientId =>
    IngredientId.unsafe(accountId('foodExclusion', ordinal));

/**
 * Where the store starts minting identifiers for rows a *person* creates — a second address, a
 * resent challenge, a newly added phone number.
 *
 * Fixtures occupy the low ordinals; runtime rows occupy `0x80` upwards, so a failing test can tell
 * "this came from the seed" from "this was created by the interaction under test" from the
 * identifier alone.
 */
export const ACCOUNT_RUNTIME_ORDINAL_START = 0x80;
