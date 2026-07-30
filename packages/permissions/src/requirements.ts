import { ROUTE_AREAS } from '@healthy360/domain-types';
import type { RouteArea } from '@healthy360/domain-types';

/**
 * What a route area (or an individual screen) demands before it may render.
 *
 * Every field is optional and additive; an empty requirement other than `area` means "anyone the
 * build family lets in". Requirements are *declarative data* so the whole registry can be swept in
 * a table-driven test.
 */
export interface RouteRequirement {
    readonly area: RouteArea;
    readonly requiresAuth?: boolean | undefined;
    readonly requiresVerifiedEmail?: boolean | undefined;
    readonly requiresOrg?: boolean | undefined;
    readonly requiresBranch?: boolean | undefined;
    /** Feature entitlements — all of them must be present (plan §10 "separate concerns"). */
    readonly entitlements?: readonly string[] | undefined;
    /** Permission keys where every key is required. */
    readonly allOf?: readonly string[] | undefined;
    /** Permission keys where at least one is required. */
    readonly anyOf?: readonly string[] | undefined;
}

/** Destinations the guard kernel redirects to. Kept here so hrefs are asserted, not typed twice. */
export const ROUTE_PATHS = {
    root: '/',
    signIn: '/sign-in',
    verifyEmail: '/verify-email',
    selectOrganisation: '/select-organisation',
    selectBranch: '/select-branch',
    forbidden: '/forbidden',
    workspace: '/workspace',
    customerHome: '/customer',
    posHome: '/pos',
    driverHome: '/driver',
} as const;

export type RoutePath = (typeof ROUTE_PATHS)[keyof typeof ROUTE_PATHS];

const AUTHENTICATED_ORG_AREA = {
    requiresAuth: true,
    requiresVerifiedEmail: true,
    requiresOrg: true,
} as const;

/**
 * The per-area baseline registry (plan §17).
 *
 * `public` and `auth` are unguarded beyond the build-mode gate; every other area requires an
 * authenticated, email-verified user in a server-confirmed organisation context. Branch context is
 * required only where an operation is physically bound to a site — kitchen, POS and KDS.
 *
 * Entitlement keys mirror `feature_definitions` rows (plan §7) and must be reconciled with the
 * backend feature registry when Phase 4 lands; they are named `module.<area>` for now.
 *
 * Screens may tighten this baseline (never loosen it) by passing their own `RouteRequirement`.
 */
export const ROUTE_REQUIREMENTS: Readonly<Record<RouteArea, RouteRequirement>> = {
    public: { area: 'public' },
    auth: { area: 'auth' },

    customer: { area: 'customer', ...AUTHENTICATED_ORG_AREA },
    patient: { area: 'patient', ...AUTHENTICATED_ORG_AREA },

    dietitian: {
        area: 'dietitian',
        ...AUTHENTICATED_ORG_AREA,
        entitlements: ['module.dietitian'],
    },
    clinic: { area: 'clinic', ...AUTHENTICATED_ORG_AREA, entitlements: ['module.clinic'] },

    kitchen: {
        area: 'kitchen',
        ...AUTHENTICATED_ORG_AREA,
        requiresBranch: true,
        entitlements: ['module.kitchen'],
    },
    pos: {
        area: 'pos',
        ...AUTHENTICATED_ORG_AREA,
        requiresBranch: true,
        entitlements: ['module.pos'],
    },
    kds: {
        area: 'kds',
        ...AUTHENTICATED_ORG_AREA,
        requiresBranch: true,
        entitlements: ['module.kds'],
    },

    driver: { area: 'driver', ...AUTHENTICATED_ORG_AREA, entitlements: ['module.delivery'] },
    partner: { area: 'partner', ...AUTHENTICATED_ORG_AREA, entitlements: ['module.marketplace'] },
    corporate: { area: 'corporate', ...AUTHENTICATED_ORG_AREA, entitlements: ['module.corporate'] },
    insurance: { area: 'insurance', ...AUTHENTICATED_ORG_AREA, entitlements: ['module.insurance'] },

    'platform-admin': {
        area: 'platform-admin',
        ...AUTHENTICATED_ORG_AREA,
        allOf: ['platform.access_admin'],
    },
};

export function requirementForArea(area: RouteArea): RouteRequirement {
    return ROUTE_REQUIREMENTS[area];
}

/** Merges a screen-level requirement onto its area baseline. Screens may only tighten. */
export function mergeRequirements(
    base: RouteRequirement,
    override: Omit<RouteRequirement, 'area'>,
): RouteRequirement {
    return {
        area: base.area,
        requiresAuth: override.requiresAuth ?? base.requiresAuth,
        requiresVerifiedEmail: override.requiresVerifiedEmail ?? base.requiresVerifiedEmail,
        requiresOrg: override.requiresOrg ?? base.requiresOrg,
        requiresBranch: override.requiresBranch ?? base.requiresBranch,
        entitlements: [...(base.entitlements ?? []), ...(override.entitlements ?? [])],
        allOf: [...(base.allOf ?? []), ...(override.allOf ?? [])],
        anyOf: override.anyOf ?? base.anyOf,
    };
}

/** Every area, in registry order — convenience for exhaustive tests and dev tooling. */
export const ALL_ROUTE_REQUIREMENTS: readonly RouteRequirement[] = ROUTE_AREAS.map(
    (area) => ROUTE_REQUIREMENTS[area],
);
