import { ROUTE_AREAS } from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import {
    ALL_ROUTE_REQUIREMENTS,
    ROUTE_PATHS,
    ROUTE_REQUIREMENTS,
    mergeRequirements,
    requirementForArea,
} from './requirements.ts';

describe('ROUTE_REQUIREMENTS registry', () => {
    it('declares exactly one requirement per registry area, self-labelled', () => {
        expect(Object.keys(ROUTE_REQUIREMENTS).sort()).toEqual([...ROUTE_AREAS].sort());
        for (const area of ROUTE_AREAS) {
            expect(ROUTE_REQUIREMENTS[area].area).toBe(area);
            expect(requirementForArea(area)).toBe(ROUTE_REQUIREMENTS[area]);
        }
        expect(ALL_ROUTE_REQUIREMENTS).toHaveLength(ROUTE_AREAS.length);
    });

    it('guards every area except public and auth with auth + verified email + organisation', () => {
        for (const area of ROUTE_AREAS) {
            const requirement = ROUTE_REQUIREMENTS[area];
            if (area === 'public' || area === 'auth') {
                expect(requirement.requiresAuth).toBeUndefined();
                continue;
            }
            expect(requirement.requiresAuth).toBe(true);
            expect(requirement.requiresVerifiedEmail).toBe(true);
            expect(requirement.requiresOrg).toBe(true);
        }
    });

    it('uses module.<feature> entitlement keys only', () => {
        for (const requirement of ALL_ROUTE_REQUIREMENTS) {
            for (const key of requirement.entitlements ?? []) {
                expect(key).toMatch(/^module\.[a-z]+$/);
            }
        }
    });

    it('uses domain.action_scope permission keys only (plan §10)', () => {
        for (const requirement of ALL_ROUTE_REQUIREMENTS) {
            for (const key of [...(requirement.allOf ?? []), ...(requirement.anyOf ?? [])]) {
                expect(key).toMatch(/^[a-z][a-z_]*\.[a-z][a-z_]*$/);
            }
        }
    });

    it('gates platform-admin on an explicit permission', () => {
        expect(ROUTE_REQUIREMENTS['platform-admin'].allOf).toEqual(['platform.access_admin']);
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
            entitlements: ['module.production'],
            allOf: ['kitchen.manage_current'],
        });

        expect(merged.area).toBe('kitchen');
        expect(merged.requiresBranch).toBe(true);
        expect(merged.entitlements).toEqual(['module.kitchen', 'module.production']);
        expect(merged.allOf).toEqual(['kitchen.manage_current']);
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
