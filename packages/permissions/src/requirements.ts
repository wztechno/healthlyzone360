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

/**
 * Feature entitlement codes the backend actually seeds (`feature_definitions`, plan §7).
 *
 * This list is the *whole* Phase 1 entitlement vocabulary. It is exported so that fixtures, the
 * mock repositories and the entitlement-gate tests all speak the same language as the API instead
 * of inventing keys the server will never send.
 */
export const FEATURE_CODES = [
    'feature.two_factor_enforcement',
    'feature.multi_branch',
    'feature.api_access',
    'feature.audit_export',
] as const;
export type FeatureCode = (typeof FEATURE_CODES)[number];

export function isFeatureCode(value: string): value is FeatureCode {
    return (FEATURE_CODES as readonly string[]).includes(value);
}

/**
 * Consumers hold one *global* Healthy360 identity (plan §9): they are people, not staff of an
 * organisation, so the consumer-facing areas must not force organisation selection before the
 * landing screen will render. Individual organisation-bound screens inside them still tighten the
 * baseline with their own `requiresOrg`.
 */
const CONSUMER_AREA = {
    requiresAuth: true,
    requiresVerifiedEmail: true,
} as const;

/** Staff areas are entered through a server-confirmed organisation membership. */
const AUTHENTICATED_ORG_AREA = {
    ...CONSUMER_AREA,
    requiresOrg: true,
} as const;

/**
 * The per-area baseline registry (plan §17).
 *
 * `public` and `auth` are unguarded beyond the build-mode gate. `customer` and `patient` require an
 * authenticated, email-verified user but **no** organisation context (orchestrator decision D1 —
 * see `docs/architecture/notes/phase5b-decisions.md`). Every remaining area is a staff area and
 * additionally requires a server-confirmed organisation context. Branch context is required only
 * where an operation is physically bound to a site — kitchen, POS and KDS.
 *
 * **No area is entitlement-gated in Phase 1** (orchestrator decision D2). The backend seeds four
 * `feature.*` definitions and none of them maps to "may this area render". The entitlement gate in
 * `evaluateGates` remains fully implemented and fully tested — with the real `FEATURE_CODES` as
 * fixtures — so that a route or a screen can opt into one the day a feature genuinely gates an area.
 *
 * Screens may tighten this baseline (never loosen it) by passing their own `RouteRequirement`.
 */
export const ROUTE_REQUIREMENTS: Readonly<Record<RouteArea, RouteRequirement>> = {
    public: { area: 'public' },
    auth: { area: 'auth' },

    customer: { area: 'customer', ...CONSUMER_AREA },
    patient: { area: 'patient', ...CONSUMER_AREA },

    dietitian: { area: 'dietitian', ...AUTHENTICATED_ORG_AREA },
    clinic: { area: 'clinic', ...AUTHENTICATED_ORG_AREA },

    kitchen: { area: 'kitchen', ...AUTHENTICATED_ORG_AREA, requiresBranch: true },
    pos: { area: 'pos', ...AUTHENTICATED_ORG_AREA, requiresBranch: true },
    kds: { area: 'kds', ...AUTHENTICATED_ORG_AREA, requiresBranch: true },

    driver: { area: 'driver', ...AUTHENTICATED_ORG_AREA },
    partner: { area: 'partner', ...AUTHENTICATED_ORG_AREA },
    corporate: { area: 'corporate', ...AUTHENTICATED_ORG_AREA },
    insurance: { area: 'insurance', ...AUTHENTICATED_ORG_AREA },

    /**
     * The only area whose baseline carries a permission — and PA1 changed *which* one.
     *
     * It used to name `platform.access_admin`, a code that existed nowhere but this file. That was
     * defensible while the area held one screen, the design-system showcase, and the gate's only
     * job was keeping tenants out of it. It stopped being defensible the moment the area became a
     * real console: a baseline naming a permission the backend never issues is a baseline that
     * refuses everybody in `api` mode, including the platform operator it was written for.
     *
     * `organisation.manage_platform` is the code `PermissionRegistry::platformPermissions()`
     * registers and the code the seven `/platform/organisations/kitchens` routes are gated on, so
     * the sidebar, the route guard and the server now answer the same question the same way. The
     * server remains the boundary; this only stops the client offering a door that would slam.
     */
    'platform-admin': {
        area: 'platform-admin',
        ...AUTHENTICATED_ORG_AREA,
        allOf: ['organisation.manage_platform'],
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
