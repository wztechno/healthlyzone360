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
