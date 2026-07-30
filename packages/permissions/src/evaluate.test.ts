import { APP_MODES, ROUTE_AREAS } from '@healthy360/domain-types';
import type { AppMode, RouteArea } from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import {
    DENIAL_REASONS,
    GATES,
    GATE_DENIAL_REASON,
    denialReason,
    evaluateArea,
    evaluateGates,
    isAllowed,
    isPending,
} from './evaluate.ts';
import type { Gate, GateResult } from './evaluate.ts';
import { MODE_ROUTE_AREAS, modeAllows } from './modes.ts';
import { ROUTE_PATHS, ROUTE_REQUIREMENTS } from './requirements.ts';
import type { RouteRequirement } from './requirements.ts';
import {
    FIXTURE_OTHER_ORGANISATION_ID,
    makeAccessBranch,
    makeAccessOrganisation,
    makeAccessState,
} from './testing/make-access-state.ts';

/**
 * A requirement that demands *everything*, so a single state mutation can be shown to fail at a
 * chosen gate while every earlier gate still passes.
 */
const FULL_REQUIREMENT: RouteRequirement = {
    area: 'kitchen',
    requiresAuth: true,
    requiresVerifiedEmail: true,
    requiresOrg: true,
    requiresBranch: true,
    entitlements: ['feature.multi_branch'],
    allOf: ['kitchen.view_current'],
};

/** A state that satisfies FULL_REQUIREMENT completely. */
function fullyHydrated() {
    return makeAccessState({
        mode: 'all-dev',
        session: 'authenticated',
        emailVerified: true,
        organisation: makeAccessOrganisation(),
        branch: makeAccessBranch(),
        entitlements: ['feature.multi_branch'],
        permissions: ['kitchen.view_current'],
    });
}

describe('contract surface', () => {
    it('declares the seven gates in plan §17 order', () => {
        expect([...GATES]).toEqual([
            'mode',
            'authentication',
            'email_verification',
            'organisation',
            'branch',
            'entitlement',
            'permission',
        ]);
    });

    it('declares one stable denial reason per gate', () => {
        expect([...DENIAL_REASONS]).toEqual([
            'mode_excluded',
            'unauthenticated',
            'email_unverified',
            'no_organisation_context',
            'no_branch_context',
            'entitlement_missing',
            'permission_missing',
        ]);
        expect(Object.keys(GATE_DENIAL_REASON)).toEqual([...GATES]);
        expect(new Set(Object.values(GATE_DENIAL_REASON)).size).toBe(GATES.length);
    });
});

describe('allow path', () => {
    it('allows when every gate is satisfied', () => {
        expect(evaluateGates(fullyHydrated(), FULL_REQUIREMENT)).toEqual({ status: 'allow' });
    });

    it('allows an unguarded requirement for an anonymous, unverified user', () => {
        const state = makeAccessState({
            mode: 'customer',
            session: 'anonymous',
            emailVerified: false,
        });
        expect(evaluateGates(state, { area: 'public' })).toEqual({ status: 'allow' });
        expect(evaluateGates(state, { area: 'auth' })).toEqual({ status: 'allow' });
    });

    it('does not block a restoring session on an unguarded route', () => {
        const state = makeAccessState({ mode: 'customer', session: 'restoring' });
        expect(evaluateGates(state, { area: 'public' })).toEqual({ status: 'allow' });
    });
});

/**
 * Gate-by-gate matrix: for each gate, break exactly that gate on an otherwise fully hydrated state
 * and assert the outcome. This is what pins the *order* down — every earlier gate is satisfied, so
 * the failing gate is unambiguous.
 */
describe('every gate × its failure', () => {
    const cases: ReadonlyArray<{
        gate: Gate;
        label: string;
        state: () => ReturnType<typeof makeAccessState>;
        expected: GateResult;
    }> = [
        {
            gate: 'mode',
            label: 'area not compiled into the build family',
            // `customer` builds do not include the kitchen area.
            state: () => makeAccessState({ ...fullyHydrated(), mode: 'customer' }),
            expected: { status: 'deny', gate: 'mode', reason: 'mode_excluded' },
        },
        {
            gate: 'authentication',
            label: 'anonymous session',
            state: () => makeAccessState({ ...fullyHydrated(), session: 'anonymous' }),
            expected: {
                status: 'redirect',
                gate: 'authentication',
                href: ROUTE_PATHS.signIn,
                reason: 'unauthenticated',
            },
        },
        {
            gate: 'authentication',
            label: 'session still restoring',
            state: () => makeAccessState({ ...fullyHydrated(), session: 'restoring' }),
            expected: { status: 'pending', gate: 'authentication' },
        },
        {
            gate: 'email_verification',
            label: 'email not verified',
            state: () => makeAccessState({ ...fullyHydrated(), emailVerified: false }),
            expected: {
                status: 'redirect',
                gate: 'email_verification',
                href: ROUTE_PATHS.verifyEmail,
                reason: 'email_unverified',
            },
        },
        {
            gate: 'organisation',
            label: 'no organisation selected',
            state: () => makeAccessState({ ...fullyHydrated(), organisation: undefined }),
            expected: {
                status: 'redirect',
                gate: 'organisation',
                href: ROUTE_PATHS.selectOrganisation,
                reason: 'no_organisation_context',
            },
        },
        {
            gate: 'organisation',
            label: 'membership suspended',
            state: () =>
                makeAccessState({
                    ...fullyHydrated(),
                    organisation: makeAccessOrganisation({ membershipStatus: 'suspended' }),
                }),
            expected: {
                status: 'redirect',
                gate: 'organisation',
                href: ROUTE_PATHS.selectOrganisation,
                reason: 'no_organisation_context',
            },
        },
        {
            gate: 'branch',
            label: 'no branch selected',
            state: () => makeAccessState({ ...fullyHydrated(), branch: undefined }),
            expected: {
                status: 'redirect',
                gate: 'branch',
                href: ROUTE_PATHS.selectBranch,
                reason: 'no_branch_context',
            },
        },
        {
            gate: 'branch',
            label: 'branch belongs to a different organisation',
            state: () =>
                makeAccessState({
                    ...fullyHydrated(),
                    branch: makeAccessBranch({ organisationId: FIXTURE_OTHER_ORGANISATION_ID }),
                }),
            expected: {
                status: 'redirect',
                gate: 'branch',
                href: ROUTE_PATHS.selectBranch,
                reason: 'no_branch_context',
            },
        },
        {
            gate: 'entitlement',
            label: 'feature not entitled',
            state: () => makeAccessState({ ...fullyHydrated(), entitlements: [] }),
            expected: {
                status: 'deny',
                gate: 'entitlement',
                reason: 'entitlement_missing',
                missing: ['feature.multi_branch'],
            },
        },
        {
            gate: 'permission',
            label: 'permission not granted',
            state: () => makeAccessState({ ...fullyHydrated(), permissions: [] }),
            expected: {
                status: 'deny',
                gate: 'permission',
                reason: 'permission_missing',
                missing: ['kitchen.view_current'],
            },
        },
    ];

    it.each(cases)('gate $gate fails on $label', ({ state, expected }) => {
        expect(evaluateGates(state(), FULL_REQUIREMENT)).toEqual(expected);
    });

    it('covers every gate at least once', () => {
        expect(new Set(cases.map((c) => c.gate))).toEqual(new Set(GATES));
    });
});

/**
 * Order matrix: when several gates would fail simultaneously, the earliest one must win.
 * Each row breaks everything from the named gate onwards.
 */
describe('gate ordering — the earliest failure wins', () => {
    const brokenFromGate: Readonly<Record<Gate, () => ReturnType<typeof makeAccessState>>> = {
        mode: () =>
            makeAccessState({
                mode: 'customer',
                session: 'anonymous',
                emailVerified: false,
                organisation: undefined,
                branch: undefined,
            }),
        authentication: () =>
            makeAccessState({
                mode: 'all-dev',
                session: 'anonymous',
                emailVerified: false,
                organisation: undefined,
                branch: undefined,
            }),
        email_verification: () =>
            makeAccessState({
                mode: 'all-dev',
                session: 'authenticated',
                emailVerified: false,
                organisation: undefined,
                branch: undefined,
            }),
        organisation: () =>
            makeAccessState({
                mode: 'all-dev',
                session: 'authenticated',
                emailVerified: true,
                organisation: undefined,
                branch: undefined,
            }),
        branch: () =>
            makeAccessState({
                mode: 'all-dev',
                session: 'authenticated',
                emailVerified: true,
                organisation: makeAccessOrganisation(),
                branch: undefined,
            }),
        entitlement: () =>
            makeAccessState({
                mode: 'all-dev',
                session: 'authenticated',
                emailVerified: true,
                organisation: makeAccessOrganisation(),
                branch: makeAccessBranch(),
            }),
        permission: () =>
            makeAccessState({
                mode: 'all-dev',
                session: 'authenticated',
                emailVerified: true,
                organisation: makeAccessOrganisation(),
                branch: makeAccessBranch(),
                entitlements: ['feature.multi_branch'],
            }),
    };

    it.each(GATES)('stops at gate %s even though later gates would also fail', (gate) => {
        const result = evaluateGates(brokenFromGate[gate](), FULL_REQUIREMENT);
        const reportedGate = result.status === 'allow' ? null : result.gate;
        expect(reportedGate).toBe(gate);
        if (gate === 'authentication') {
            // Anonymous → redirect; the restoring variant is asserted separately.
            expect(denialReason(result)).toBe('unauthenticated');
        } else {
            expect(denialReason(result)).toBe(GATE_DENIAL_REASON[gate]);
        }
    });

    it('reports pending before any later denial when the session is restoring', () => {
        const state = makeAccessState({
            mode: 'all-dev',
            session: 'restoring',
            emailVerified: false,
            organisation: undefined,
            branch: undefined,
        });
        const result = evaluateGates(state, FULL_REQUIREMENT);
        expect(result).toEqual({ status: 'pending', gate: 'authentication' });
        expect(isPending(result)).toBe(true);
        expect(isAllowed(result)).toBe(false);
        expect(denialReason(result)).toBeNull();
    });

    it('still applies the mode gate before pending', () => {
        const state = makeAccessState({ mode: 'customer', session: 'restoring' });
        expect(evaluateGates(state, FULL_REQUIREMENT)).toEqual({
            status: 'deny',
            gate: 'mode',
            reason: 'mode_excluded',
        });
    });
});

describe('implicit authentication requirement', () => {
    const implicit: ReadonlyArray<[string, RouteRequirement]> = [
        ['requiresVerifiedEmail', { area: 'clinic', requiresVerifiedEmail: true }],
        ['requiresOrg', { area: 'clinic', requiresOrg: true }],
        ['requiresBranch', { area: 'clinic', requiresBranch: true }],
        ['entitlements', { area: 'clinic', entitlements: ['feature.audit_export'] }],
        ['allOf', { area: 'clinic', allOf: ['clinic.view_current'] }],
        ['anyOf', { area: 'clinic', anyOf: ['clinic.view_current'] }],
    ];

    it.each(implicit)('%s implies authentication', (_label, requirement) => {
        const state = makeAccessState({ mode: 'all-dev', session: 'anonymous' });
        expect(evaluateGates(state, requirement)).toEqual({
            status: 'redirect',
            gate: 'authentication',
            href: ROUTE_PATHS.signIn,
            reason: 'unauthenticated',
        });
    });

    it('does not require authentication when nothing is demanded', () => {
        const state = makeAccessState({ mode: 'all-dev', session: 'anonymous' });
        expect(evaluateGates(state, { area: 'public' })).toEqual({ status: 'allow' });
    });
});

describe('branch-scoped memberships', () => {
    it('demands a branch when the membership is branch-scoped even if the route does not', () => {
        const state = makeAccessState({
            organisation: makeAccessOrganisation({ requiresBranchSelection: true }),
        });
        const result = evaluateGates(state, { area: 'clinic', requiresOrg: true });
        expect(result).toEqual({
            status: 'redirect',
            gate: 'branch',
            href: ROUTE_PATHS.selectBranch,
            reason: 'no_branch_context',
        });
    });

    it('is satisfied once a branch in the same organisation is confirmed', () => {
        const state = makeAccessState({
            organisation: makeAccessOrganisation({ requiresBranchSelection: true }),
            branch: makeAccessBranch(),
        });
        expect(evaluateGates(state, { area: 'clinic', requiresOrg: true })).toEqual({
            status: 'allow',
        });
    });

    it('ignores membership branch scope when the route requires no organisation', () => {
        const state = makeAccessState({
            organisation: makeAccessOrganisation({ requiresBranchSelection: true }),
        });
        expect(evaluateGates(state, { area: 'auth' })).toEqual({ status: 'allow' });
    });
});

describe('entitlement gate', () => {
    it('reports every missing entitlement, not just the first', () => {
        const state = makeAccessState({ entitlements: ['feature.api_access'] });
        expect(
            evaluateGates(state, {
                area: 'clinic',
                entitlements: [
                    'feature.api_access',
                    'feature.audit_export',
                    'feature.multi_branch',
                ],
            }),
        ).toEqual({
            status: 'deny',
            gate: 'entitlement',
            reason: 'entitlement_missing',
            missing: ['feature.audit_export', 'feature.multi_branch'],
        });
    });

    it('passes when the state holds a superset', () => {
        const state = makeAccessState({
            entitlements: ['feature.api_access', 'feature.audit_export'],
        });
        expect(
            evaluateGates(state, { area: 'clinic', entitlements: ['feature.api_access'] }),
        ).toEqual({
            status: 'allow',
        });
    });

    it('treats an empty entitlement list as no requirement', () => {
        expect(evaluateGates(makeAccessState(), { area: 'clinic', entitlements: [] })).toEqual({
            status: 'allow',
        });
    });
});

describe('permission gate', () => {
    it('allOf requires every key and reports the missing ones', () => {
        const state = makeAccessState({ permissions: ['a.read'] });
        expect(evaluateGates(state, { area: 'clinic', allOf: ['a.read', 'b.read'] })).toEqual({
            status: 'deny',
            gate: 'permission',
            reason: 'permission_missing',
            missing: ['b.read'],
        });
    });

    it('anyOf is satisfied by a single key', () => {
        const state = makeAccessState({ permissions: ['b.read'] });
        expect(evaluateGates(state, { area: 'clinic', anyOf: ['a.read', 'b.read'] })).toEqual({
            status: 'allow',
        });
    });

    it('anyOf denies and reports the full candidate list when none match', () => {
        const state = makeAccessState({ permissions: ['c.read'] });
        expect(evaluateGates(state, { area: 'clinic', anyOf: ['a.read', 'b.read'] })).toEqual({
            status: 'deny',
            gate: 'permission',
            reason: 'permission_missing',
            missing: ['a.read', 'b.read'],
        });
    });

    it('evaluates allOf before anyOf', () => {
        const state = makeAccessState({ permissions: ['b.read'] });
        expect(
            evaluateGates(state, { area: 'clinic', allOf: ['a.read'], anyOf: ['b.read'] }),
        ).toEqual({
            status: 'deny',
            gate: 'permission',
            reason: 'permission_missing',
            missing: ['a.read'],
        });
    });
});

describe('evaluateArea against the registry', () => {
    const hydratedFor = (area: RouteArea) => {
        const requirement = ROUTE_REQUIREMENTS[area];
        return makeAccessState({
            mode: 'all-dev',
            session: 'authenticated',
            emailVerified: true,
            organisation: makeAccessOrganisation(),
            branch: makeAccessBranch(),
            entitlements: requirement.entitlements ?? [],
            permissions: [...(requirement.allOf ?? []), ...(requirement.anyOf ?? [])],
        });
    };

    it.each(ROUTE_AREAS)('all-dev + fully hydrated state may enter %s', (area) => {
        expect(evaluateArea(hydratedFor(area), area)).toEqual({ status: 'allow' });
    });

    it.each(ROUTE_AREAS)(
        'an anonymous user is turned away from %s unless it is public/auth',
        (area) => {
            const state = makeAccessState({
                mode: 'all-dev',
                session: 'anonymous',
                emailVerified: false,
            });
            const result = evaluateArea(state, area);
            if (area === 'public' || area === 'auth') {
                expect(result).toEqual({ status: 'allow' });
            } else {
                expect(result).toEqual({
                    status: 'redirect',
                    gate: 'authentication',
                    href: ROUTE_PATHS.signIn,
                    reason: 'unauthenticated',
                });
            }
        },
    );

    /** Decision D1 — a consumer's global identity is enough for the consumer areas (plan §9). */
    it.each(['customer', 'patient'] as const)(
        'lets a verified consumer with no organisation into %s',
        (area) => {
            const state = makeAccessState({
                mode: 'customer',
                session: 'authenticated',
                emailVerified: true,
                organisation: undefined,
                branch: undefined,
            });
            expect(evaluateArea(state, area)).toEqual({ status: 'allow' });
        },
    );

    it('still redirects a verified consumer without an organisation away from staff areas', () => {
        const state = makeAccessState({
            mode: 'all-dev',
            session: 'authenticated',
            emailVerified: true,
            organisation: undefined,
        });
        for (const area of ROUTE_AREAS) {
            if (['public', 'auth', 'customer', 'patient'].includes(area)) continue;
            expect(evaluateArea(state, area), area).toEqual({
                status: 'redirect',
                gate: 'organisation',
                href: ROUTE_PATHS.selectOrganisation,
                reason: 'no_organisation_context',
            });
        }
    });

    it('still demands email verification in the consumer areas', () => {
        const state = makeAccessState({
            mode: 'customer',
            session: 'authenticated',
            emailVerified: false,
        });
        expect(evaluateArea(state, 'customer')).toEqual({
            status: 'redirect',
            gate: 'email_verification',
            href: ROUTE_PATHS.verifyEmail,
            reason: 'email_unverified',
        });
    });

    /** Decision D2 — the registry is entitlement-free; a hydrated state needs no entitlements. */
    it('admits a fully permitted user holding no entitlements at all into every area', () => {
        for (const area of ROUTE_AREAS) {
            const requirement = ROUTE_REQUIREMENTS[area];
            const state = makeAccessState({
                mode: 'all-dev',
                organisation: makeAccessOrganisation(),
                branch: makeAccessBranch(),
                entitlements: [],
                permissions: [...(requirement.allOf ?? []), ...(requirement.anyOf ?? [])],
            });
            expect(evaluateArea(state, area), area).toEqual({ status: 'allow' });
        }
    });

    it('requires a branch for exactly kitchen, pos and kds', () => {
        const branchAreas = ROUTE_AREAS.filter(
            (area) => ROUTE_REQUIREMENTS[area].requiresBranch === true,
        );
        expect([...branchAreas]).toEqual(['kitchen', 'pos', 'kds']);
    });

    it('leaves public and auth completely unguarded', () => {
        for (const area of ['public', 'auth'] as const) {
            expect(ROUTE_REQUIREMENTS[area]).toEqual({ area });
        }
    });
});

/**
 * Full mode × area sweep: for every build family and every registry area, the mode gate must agree
 * with MODE_ROUTE_AREAS, and excluded areas must deny before any other consideration.
 */
describe('mode × area matrix', () => {
    const combinations: ReadonlyArray<[AppMode, RouteArea]> = APP_MODES.flatMap((mode) =>
        ROUTE_AREAS.map((area) => [mode, area] as [AppMode, RouteArea]),
    );

    it('covers all 70 combinations', () => {
        expect(combinations).toHaveLength(APP_MODES.length * ROUTE_AREAS.length);
        expect(combinations).toHaveLength(70);
    });

    it.each(combinations)('%s × %s matches MODE_ROUTE_AREAS', (mode, area) => {
        const allowed = MODE_ROUTE_AREAS[mode].includes(area);
        expect(modeAllows(mode, area)).toBe(allowed);

        const state = makeAccessState({
            mode,
            session: 'authenticated',
            emailVerified: true,
            organisation: makeAccessOrganisation(),
            branch: makeAccessBranch(),
            entitlements: ROUTE_REQUIREMENTS[area].entitlements ?? [],
            permissions: ROUTE_REQUIREMENTS[area].allOf ?? [],
        });
        const result = evaluateArea(state, area);

        if (allowed) {
            expect(result).toEqual({ status: 'allow' });
        } else {
            expect(result).toEqual({ status: 'deny', gate: 'mode', reason: 'mode_excluded' });
        }
    });
});
