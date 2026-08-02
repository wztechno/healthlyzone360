export {
    AL_QUOZ_BRANCH,
    CEDAR_CLINIC,
    HAMRA_BRANCH,
    JOUNIEH_BRANCH,
    MOCK_BRANCHES,
    MOCK_CREATED_AT,
    MOCK_GLOBAL_PERMISSIONS,
    MOCK_NOW,
    MOCK_ORGANISATIONS,
    MOCK_ORGANISATION_ENTITLEMENTS,
    MOCK_PASSWORD,
    MOCK_ROLES,
    MOCK_ROLE_PERMISSIONS,
    VERDANT_KITCHEN,
    entitlementsForOrganisation,
    permissionsForMembership,
} from './fixtures.ts';

export {
    MOCK_BRANCH_IDS,
    MOCK_DEVICE_IDS,
    MOCK_MEMBERSHIP_IDS,
    MOCK_ORGANISATION_IDS,
    MOCK_ROLE_IDS,
    MOCK_USER_IDS,
} from './ids.ts';

export {
    DEFAULT_MOCK_SCENARIO,
    MOCK_SCENARIOS,
    MOCK_SCENARIO_NAMES,
    isMockScenarioName,
    resolveScenario,
} from './scenarios.ts';
export type { MockAccount, MockScenario, MockScenarioName } from './scenarios.ts';

export {
    LOGIN_ATTEMPT_LIMIT,
    LOGIN_RATE_LIMIT_RETRY_AFTER_SECONDS,
    MOCK_PASSWORD_RESET_TOKEN,
    MOCK_RECOVERY_CODE,
    MOCK_TOTP_CODE,
    MOCK_TWO_FACTOR_SECRET,
    MockStore,
    RESEND_COOLDOWN_SECONDS,
    STEP_UP_WINDOW_SECONDS,
} from './store.ts';
export type { Clock } from './store.ts';

export { DEFAULT_MOCK_LATENCY_MS, createMockRepositories } from './repositories.ts';
export type { MockRepositories, MockRepositoriesOptions } from './repositories.ts';

/**
 * The Prompt 2 prototype world — the store and the repositories over it.
 *
 * The **fixtures** are deliberately not re-exported here. A screen reaches data through
 * repositories; a test that needs a known identifier imports `./prototype/fixtures/index.ts`
 * directly and is visibly doing so.
 */
export {
    PROTOTYPE_ADDRESS,
    PROTOTYPE_DELIVERY_SLOTS,
    PROTOTYPE_ID_BANDS,
    PROTOTYPE_ID_PREFIX,
    PROTOTYPE_NOW,
    PROTOTYPE_TODAY,
    PROTOTYPE_WEEK_START,
    PrototypeStore,
    createPrototypeRepositories,
} from './prototype/index.ts';
export type {
    PrototypeIdBand,
    PrototypeRepositories,
    PrototypeRepositoriesOptions,
    PrototypeRepositoryBundle,
    PrototypeStoreOptions,
} from './prototype/index.ts';

/**
 * The J1 account-and-verification world.
 *
 * `MOCK_OTP_CODE` is re-exported here — and only here, not from the package root — because the only
 * things that need it are the mock world's own tests and the Playwright specs that drive the OTP
 * panel. A screen never types a code for itself.
 */
export {
    ACCOUNT_ID_BANDS,
    ACCOUNT_ID_PREFIX,
    AccountMockStore,
    DEFAULT_ACCOUNT_MOCK_LATENCY_MS,
    MOCK_OTP_CODE,
    OTP_CODE_LENGTH,
    OTP_EXPIRY_SECONDS,
    OTP_LOCKOUT_SECONDS,
    OTP_MAX_ATTEMPTS,
    OTP_MAX_RESENDS,
    OTP_REPEAT_LOCKOUT_SECONDS,
    OTP_RESEND_COOLDOWN_SECONDS,
    SEED_CONSENTS,
    SEED_CONTACTS,
    SEED_SERVICE_AREAS,
    SIMULATED_CHANNELS,
    createAccountMockRepositories,
} from './account/index.ts';
export type {
    AccountMockRepositories,
    AccountMockRepositoriesOptions,
    AccountMockStoreOptions,
} from './account/index.ts';

/**
 * The B1 B2B-onboarding world.
 *
 * `MOCK_SIGNING_TOKEN` is re-exported here — and only here, not from the package root — on the same
 * terms as `MOCK_OTP_CODE`: the only things that need it are the mock world's own tests and the
 * specs that drive the signing panel. A screen never invents a step-up token for itself.
 */
export {
    AGREEMENT_CONSENT_STATEMENT,
    AGREEMENT_DOCUMENT_SHA256,
    B2B_FIXTURES,
    B2B_FIXTURE_NAMES,
    B2B_ID_BANDS,
    B2B_ID_PREFIX,
    B2B_SEED_NOW,
    B2bMockStore,
    DEFAULT_B2B_FIXTURE,
    DEFAULT_B2B_MOCK_LATENCY_MS,
    DOCUMENT_LINK_TTL_SECONDS,
    MOCK_SIGNING_TOKEN,
    createB2bMockRepositories,
} from './b2b-application/index.ts';
export type {
    B2bFixture,
    B2bFixtureName,
    B2bMockRepositories,
    B2bMockRepositoriesOptions,
    B2bMockStoreOptions,
} from './b2b-application/index.ts';

/**
 * The G1 guest world.
 *
 * Re-exported here and not from the package root, on the same terms as the account world: the only
 * things that need it are this package's own tests and the Playwright specs that drive the guest
 * checkout. A screen reaches it through the application's shim, never by importing a fixture.
 */
export {
    GUEST_DATA_TTL_SECONDS,
    GUEST_ID_BANDS,
    GUEST_ID_PREFIX,
    GUEST_SESSION_TTL_SECONDS,
    GuestMockStore,
    capabilitiesFor,
    createFallbackCartPort,
    createGuestMockRepositories,
    guestOrderReferenceAt,
    guestTokenAt,
} from './guest/index.ts';
export type {
    GuestCartPort,
    GuestMockRepositories,
    GuestMockRepositoriesOptions,
    GuestMockStoreOptions,
} from './guest/index.ts';
