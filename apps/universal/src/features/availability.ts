import type { RouteArea } from '@healthy360/domain-types';

/**
 * Which product features have a real backend behind them.
 *
 * This table is the **mirror image** of `packages/api-client/src/api/prototype-repositories.ts`:
 * that file lists the repository methods the Laravel API does not implement yet, this one lists the
 * user-facing features those gaps make undeliverable. A key flips to `true` on the day its endpoints
 * land, and the entry points below it come back — nav items, tiles, footer links, in-screen buttons
 * — without any of the feature code having been deleted in the meantime.
 *
 * ## Why a build-time constant
 *
 * Three alternatives were available and all three are worse:
 *
 * * **A runtime probe** ("call the endpoint, hide the button if it 404s") turns every navigation
 *   decision into a network round trip, paints the entry point before it can be withdrawn, and makes
 *   the shape of the application depend on whether the API happened to answer.
 * * **`Repositories.kind`** answers "am I on mock data?", which is a different question. Jest injects
 *   mock repositories into a build whose config is already `api`, so keying visibility off it would
 *   make the test world and the shipped world disagree about what exists.
 * * **`MODE_ROUTE_AREAS`** answers "is this area compiled into this build family?" — a packaging
 *   decision, not a backend one. A staff build compiles the clinic area whether or not a single
 *   clinic endpoint exists.
 *
 * So: a constant, read synchronously, with no session, no query and no mode in it. The only thing
 * that changes it is an editor and a commit.
 */
export const FEATURE_AVAILABILITY = {
    planner: false,
    nutrition: false,
    virtualDietitian: false,
    dietitianDirectory: false,
    dietCategories: false,
    professionalReview: false,
    partnerSupply: false,
    driverJobs: true,
    clinicWorkspace: false,
    insuranceWorkspace: false,
    patientWorkspace: false,
    quotationExport: false,
    catalogueScheduleRequest: false,
} as const satisfies Record<string, boolean>;

export type FeatureKey = keyof typeof FEATURE_AVAILABILITY;

export function isFeatureAvailable(key: FeatureKey): boolean {
    return FEATURE_AVAILABILITY[key];
}

/**
 * Route areas whose entire workspace is one unavailable feature.
 *
 * Areas absent from this map are available: `kitchen`, `corporate`, `customer`, `kds`, `auth`,
 * `public` and `platform-admin` all have real endpoints behind them, so listing them here as `true`
 * would be a second registry to keep in step with this one.
 *
 * `driver` stays listed even though `driverJobs` is now `true`. The mapping is what makes the flag
 * mean anything: an entry removed on the day its feature landed would have to be reconstructed —
 * correctly — the day the run sheet was ever taken back out.
 */
const AREA_FEATURES: Partial<Record<RouteArea, FeatureKey>> = {
    dietitian: 'professionalReview',
    partner: 'partnerSupply',
    driver: 'driverJobs',
    clinic: 'clinicWorkspace',
    insurance: 'insuranceWorkspace',
    patient: 'patientWorkspace',
};

export function isAreaAvailable(area: RouteArea): boolean {
    const key = AREA_FEATURES[area];
    return key === undefined || isFeatureAvailable(key);
}

/**
 * Path prefixes that belong to an unavailable feature, most specific first.
 *
 * Order matters only where one prefix contains another; it is kept most-specific-first so that
 * adding a narrower rule later cannot be swallowed by a broader one already in the list.
 */
const PATH_FEATURES: readonly (readonly [string, FeatureKey])[] = [
    ['/customer/planner', 'planner'],
    ['/customer/grocery', 'planner'],
    ['/customer/recipes', 'planner'],
    ['/customer/nutrition', 'nutrition'],
    ['/customer/onboarding', 'nutrition'],
    ['/customer/virtual-dietitian', 'virtualDietitian'],
    ['/tools', 'nutrition'],
    ['/dietitians', 'dietitianDirectory'],
    ['/diets', 'dietCategories'],
];

/**
 * Whether a pathname may be reached.
 *
 * A prefix matches the path itself or a segment below it — `/diets` and `/diets/high-protein` are
 * both the diet-category feature, `/dietsomething` would not be.
 */
export function isPathAvailable(pathname: string): boolean {
    for (const [prefix, key] of PATH_FEATURES) {
        if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
            return isFeatureAvailable(key);
        }
    }
    return true;
}
