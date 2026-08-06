import { ROUTE_AREAS } from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import {
    ALL_ROUTE_REQUIREMENTS,
    FEATURE_CODES,
    ROUTE_PATHS,
    ROUTE_REQUIREMENTS,
    isFeatureCode,
    mergeRequirements,
    requirementForArea,
} from './requirements.ts';

/** Areas where a consumer's global identity is enough — no organisation context (decision D1). */
const CONSUMER_AREAS = ['customer', 'patient'] as const;
const UNGUARDED_AREAS = ['public', 'auth'] as const;

describe('ROUTE_REQUIREMENTS registry', () => {
    it('declares exactly one requirement per registry area, self-labelled', () => {
        expect(Object.keys(ROUTE_REQUIREMENTS).sort()).toEqual([...ROUTE_AREAS].sort());
        for (const area of ROUTE_AREAS) {
            expect(ROUTE_REQUIREMENTS[area].area).toBe(area);
            expect(requirementForArea(area)).toBe(ROUTE_REQUIREMENTS[area]);
        }
        expect(ALL_ROUTE_REQUIREMENTS).toHaveLength(ROUTE_AREAS.length);
    });

    it('guards every area except public and auth with auth + verified email', () => {
        for (const area of ROUTE_AREAS) {
            const requirement = ROUTE_REQUIREMENTS[area];
            if ((UNGUARDED_AREAS as readonly string[]).includes(area)) {
                expect(requirement.requiresAuth).toBeUndefined();
                continue;
            }
            expect(requirement.requiresAuth).toBe(true);
            expect(requirement.requiresVerifiedEmail).toBe(true);
        }
    });

    /**
     * Decision D1 — consumers hold one global Healthy360 identity (plan §9), so the consumer areas
     * must render without an organisation. Everything else is a staff area.
     */
    it('requires organisation context for every staff area and for no consumer area', () => {
        const withOrg = ROUTE_AREAS.filter((area) => ROUTE_REQUIREMENTS[area].requiresOrg === true);
        const expected = ROUTE_AREAS.filter(
            (area) =>
                !(UNGUARDED_AREAS as readonly string[]).includes(area) &&
                !(CONSUMER_AREAS as readonly string[]).includes(area),
        );

        expect([...withOrg]).toEqual([...expected]);
        for (const area of CONSUMER_AREAS) {
            expect(ROUTE_REQUIREMENTS[area].requiresOrg).toBeUndefined();
            expect(ROUTE_REQUIREMENTS[area].requiresBranch).toBeUndefined();
        }
    });

    /**
     * Decision D2 — no area is entitlement-gated in Phase 1. The gate mechanism itself stays
     * exercised in `evaluate.test.ts` using the real `FEATURE_CODES`.
     */
    it('entitlement-gates no area at all', () => {
        for (const requirement of ALL_ROUTE_REQUIREMENTS) {
            expect(
                requirement.entitlements ?? [],
                `${requirement.area} declares entitlements`,
            ).toEqual([]);
        }
    });
});

describe('FEATURE_CODES', () => {
    it('mirrors the four feature definitions the backend seeds', () => {
        expect([...FEATURE_CODES]).toEqual([
            'feature.two_factor_enforcement',
            'feature.multi_branch',
            'feature.api_access',
            'feature.audit_export',
        ]);
    });

    it('are all namespaced under feature. and are unique', () => {
        for (const code of FEATURE_CODES) expect(code).toMatch(/^feature\.[a-z][a-z_]*$/);
        expect(new Set(FEATURE_CODES).size).toBe(FEATURE_CODES.length);
    });

    it('recognises real codes and rejects invented module.* keys', () => {
        expect(isFeatureCode('feature.multi_branch')).toBe(true);
        expect(isFeatureCode('module.kitchen')).toBe(false);
        expect(isFeatureCode('feature.made_up')).toBe(false);
    });
});

describe('permission key hygiene', () => {
    it('uses domain.action_scope permission keys only (plan §10)', () => {
        for (const requirement of ALL_ROUTE_REQUIREMENTS) {
            for (const key of [...(requirement.allOf ?? []), ...(requirement.anyOf ?? [])]) {
                expect(key).toMatch(/^[a-z][a-z_]*\.[a-z][a-z_]*$/);
            }
        }
    });

    it('gates platform-admin on an explicit permission', () => {
        expect(ROUTE_REQUIREMENTS['platform-admin'].allOf).toEqual([
            'organisation.manage_platform',
        ]);
    });
});

describe('ROUTE_PATHS', () => {
    it('are absolute, lower-case, hyphenated paths', () => {
        for (const path of Object.values(ROUTE_PATHS)) {
            expect(path).toMatch(/^\/[a-z-]*$/);
        }
    });

    it('are unique', () => {
        const values = Object.values(ROUTE_PATHS);
        expect(new Set(values).size).toBe(values.length);
    });
});

describe('mergeRequirements', () => {
    it('keeps the base area and unions entitlements and allOf', () => {
        const merged = mergeRequirements(ROUTE_REQUIREMENTS.kitchen, {
            entitlements: ['feature.multi_branch'],
            allOf: ['kitchen.manage_current'],
        });

        expect(merged.area).toBe('kitchen');
        expect(merged.requiresBranch).toBe(true);
        // The kitchen baseline is entitlement-free (D2), so the screen's own key is the only one.
        expect(merged.entitlements).toEqual(['feature.multi_branch']);
        expect(merged.allOf).toEqual(['kitchen.manage_current']);
    });

    it('unions a base entitlement with a screen entitlement when a base has one', () => {
        const merged = mergeRequirements(
            { ...ROUTE_REQUIREMENTS.clinic, entitlements: ['feature.audit_export'] },
            { entitlements: ['feature.api_access'] },
        );
        expect(merged.entitlements).toEqual(['feature.audit_export', 'feature.api_access']);
    });

    it('lets a screen tighten a flag the area left unset', () => {
        const merged = mergeRequirements(ROUTE_REQUIREMENTS.auth, { requiresAuth: true });
        expect(merged.requiresAuth).toBe(true);
        expect(merged.area).toBe('auth');
    });

    it('does not mutate the registry', () => {
        const before = JSON.stringify(ROUTE_REQUIREMENTS.kitchen);
        mergeRequirements(ROUTE_REQUIREMENTS.kitchen, { allOf: ['kitchen.manage_current'] });
        expect(JSON.stringify(ROUTE_REQUIREMENTS.kitchen)).toBe(before);
    });
});
