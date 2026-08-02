/**
 * The G1 guest mock world.
 *
 * Separate from `../store.ts`, `../prototype/` and `../account/` because it models a person with no
 * account at all, and has its own id band, its own credential and its own lifecycle. It is exported
 * from `../index.ts` but is **not** part of the required `MockRepositories` shape — the contract it
 * implements is not in the required `Repositories` bundle either, and both joins belong to the same
 * follow-up slice.
 */
export {
    GUEST_ID_BANDS,
    GUEST_ID_BAND_NAMES,
    GUEST_ID_PREFIX,
    GUEST_RUNTIME_ORDINAL_START,
    guestId,
    guestOrderReferenceAt,
    guestTokenAt,
} from './ids.ts';
export type { GuestIdBand } from './ids.ts';

export {
    GUEST_DATA_TTL_SECONDS,
    GUEST_SESSION_TTL_SECONDS,
    GuestMockStore,
    capabilitiesFor,
    createFallbackCartPort,
} from './store.ts';
export type { GuestCartPort, GuestMockStoreOptions } from './store.ts';

export { DEFAULT_GUEST_MOCK_LATENCY_MS, createGuestMockRepositories } from './repositories.ts';
export type { GuestMockRepositories, GuestMockRepositoriesOptions } from './repositories.ts';
