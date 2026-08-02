/**
 * The Prompt 2 prototype world.
 *
 * This barrel exposes the **store and the repositories**, and deliberately not the fixtures. A
 * screen depends on `Repositories`; a test may reach into `./fixtures/index.ts` directly when it
 * needs a known identifier, and nothing else should.
 *
 * The whole subtree sits behind `../repositories.ts`, which is itself behind the dynamic import in
 * `../../registry.ts`. That is what keeps sixty ingredients, twenty rolled-up recipes and forty
 * meals out of the api-mode chunk entirely.
 */

export {
    PROTOTYPE_AVAILABILITY_DAYS,
    PROTOTYPE_DISCLAIMER,
    PROTOTYPE_NOW,
    PROTOTYPE_TODAY,
    PROTOTYPE_WEEK_START,
    SYNTHETIC_SOURCE,
    SYNTHETIC_SOURCE_LABEL,
    addDays,
    atOrThrow,
    daysBetween,
    isoWeekday,
    weekDates,
} from './constants.ts';

export {
    PROTOTYPE_ID_BANDS,
    PROTOTYPE_ID_BAND_NAMES,
    PROTOTYPE_ID_PREFIX,
    PROTOTYPE_RUNTIME_ORDINAL_START,
    prototypeId,
} from './ids.ts';
export type { PrototypeIdBand } from './ids.ts';

export {
    PROTOTYPE_ADDRESS,
    PROTOTYPE_DELIVERY_FEE_FILS,
    PROTOTYPE_DELIVERY_SLOTS,
    PROTOTYPE_FREE_DELIVERY_THRESHOLD_FILS,
    PrototypeStore,
} from './store.ts';
export type { PrototypeStoreOptions } from './store.ts';

/**
 * The mutable catalogue, exposed for the same reason `PrototypeStore` is: a test may assert what a
 * management write did without going back through a repository. Screens never touch it.
 */
export { KitchenCatalogueStore, PROTOTYPE_KITCHEN_MANAGER_NAME } from './catalogue-store.ts';

export {
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    createPrototypeRepositories,
    paginate,
} from './repositories.ts';
export type {
    PrototypeRepositories,
    PrototypeRepositoriesOptions,
    PrototypeRepositoryBundle,
} from './repositories.ts';
