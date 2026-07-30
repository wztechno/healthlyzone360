import { describe, expect, it } from 'vitest';

import { can, hasEntitlements, missingEntitlements, missingPermissions } from './can.ts';
import { makeAccessState } from './testing/make-access-state.ts';

const state = makeAccessState({
    permissions: ['organisation.view_current', 'branch.manage_current'],
    entitlements: ['feature.multi_branch', 'feature.audit_export'],
});

describe('can', () => {
    it('accepts a single key', () => {
        expect(can(state, 'organisation.view_current')).toBe(true);
        expect(can(state, 'organisation.delete_platform')).toBe(false);
    });

    it("defaults to 'all'", () => {
        expect(can(state, ['organisation.view_current', 'branch.manage_current'])).toBe(true);
        expect(can(state, ['organisation.view_current', 'missing.key'])).toBe(false);
    });

    it("'any' is satisfied by one match", () => {
        expect(can(state, ['missing.key', 'branch.manage_current'], 'any')).toBe(true);
        expect(can(state, ['missing.one', 'missing.two'], 'any')).toBe(false);
    });

    it('uses mathematical empty-set semantics', () => {
        expect(can(state, [], 'all')).toBe(true);
        expect(can(state, [], 'any')).toBe(false);
    });

    it('is exact-match only — no wildcard or prefix expansion', () => {
        expect(can(state, 'organisation.*')).toBe(false);
        expect(can(state, 'organisation')).toBe(false);
        expect(can(state, 'ORGANISATION.VIEW_CURRENT')).toBe(false);
    });
});

describe('hasEntitlements', () => {
    it('requires every listed entitlement', () => {
        expect(hasEntitlements(state, 'feature.multi_branch')).toBe(true);
        expect(hasEntitlements(state, ['feature.multi_branch', 'feature.audit_export'])).toBe(true);
        expect(hasEntitlements(state, ['feature.multi_branch', 'feature.api_access'])).toBe(false);
        expect(hasEntitlements(state, [])).toBe(true);
    });
});

describe('missing* helpers', () => {
    it('preserve request order and drop satisfied keys', () => {
        expect(
            missingPermissions(state, ['z.write', 'organisation.view_current', 'a.read']),
        ).toEqual(['z.write', 'a.read']);
        expect(missingEntitlements(state, ['feature.api_access', 'feature.multi_branch'])).toEqual([
            'feature.api_access',
        ]);
    });

    it('return an empty array when nothing is missing', () => {
        expect(missingPermissions(state, ['organisation.view_current'])).toEqual([]);
        expect(missingEntitlements(state, [])).toEqual([]);
    });
});
