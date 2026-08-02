/**
 * The B1 B2B-onboarding mock world.
 *
 * Separate from `../store.ts` (the foundation's session world), `../prototype/` (the Prompt 2
 * catalogue world) and `../account/` (the J1 account world) because it is loaded by different
 * screens and has its own id bands. It is exported from `../index.ts` but is **not** part of the
 * `MockRepositories` required contracts: `B2BApplicationRepository` is not in the exported
 * `Repositories` bundle yet either, and both joins belong to the same integrator commit.
 */
export {
    B2B_ID_BANDS,
    B2B_ID_BAND_NAMES,
    B2B_ID_PREFIX,
    B2B_RUNTIME_ORDINAL_START,
    b2bId,
} from './ids.ts';
export type { B2bIdBand } from './ids.ts';

export {
    AGREEMENT_CONSENT_STATEMENT,
    AGREEMENT_DOCUMENT_SHA256,
    B2B_FIXTURES,
    B2B_FIXTURE_NAMES,
    B2B_SEED_NOW,
    DEFAULT_B2B_FIXTURE,
    SEED_APPLICANT_EMAIL,
} from './seed.ts';
export type { B2bFixture, B2bFixtureName } from './seed.ts';

export { B2bMockStore, DOCUMENT_LINK_TTL_SECONDS, MOCK_SIGNING_TOKEN } from './store.ts';
export type { B2bMockStoreOptions } from './store.ts';

export { DEFAULT_B2B_MOCK_LATENCY_MS, createB2bMockRepositories } from './repositories.ts';
export type { B2bMockRepositories, B2bMockRepositoriesOptions } from './repositories.ts';
