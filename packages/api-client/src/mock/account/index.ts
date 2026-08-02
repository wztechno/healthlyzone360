/**
 * The J1 account-and-verification mock world.
 *
 * Separate from `../store.ts` (the foundation's session world) and `../prototype/` (the Prompt 2
 * catalogue world) because it is loaded by different screens and has its own id bands. It is
 * exported from `../index.ts` but is **not** part of the `MockRepositories` bundle: the two
 * contracts it implements are not in the required `Repositories` bundle yet either, and both joins
 * belong to the same follow-up slice.
 */
export {
    ACCOUNT_ID_BANDS,
    ACCOUNT_ID_BAND_NAMES,
    ACCOUNT_ID_PREFIX,
    ACCOUNT_RUNTIME_ORDINAL_START,
    accountId,
} from './ids.ts';
export type { AccountIdBand } from './ids.ts';

export { SEED_ACCOUNT, SEED_CONSENTS, SEED_CONTACTS, SEED_SERVICE_AREAS } from './seed.ts';

export {
    AccountMockStore,
    MOCK_OTP_CODE,
    OTP_CODE_LENGTH,
    OTP_EXPIRY_SECONDS,
    OTP_LOCKOUT_SECONDS,
    OTP_MAX_ATTEMPTS,
    OTP_MAX_RESENDS,
    OTP_REPEAT_LOCKOUT_SECONDS,
    OTP_RESEND_COOLDOWN_SECONDS,
    SIMULATED_CHANNELS,
} from './store.ts';
export type { AccountMockStoreOptions } from './store.ts';

export { DEFAULT_ACCOUNT_MOCK_LATENCY_MS, createAccountMockRepositories } from './repositories.ts';
export type { AccountMockRepositories, AccountMockRepositoriesOptions } from './repositories.ts';
