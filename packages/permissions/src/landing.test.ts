import { APP_MODES } from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import { MODE_LANDING_PATHS, resolveLandingRoute } from './landing.ts';
import { ROUTE_PATHS } from './requirements.ts';
import {
    makeAccessBranch,
    makeAccessOrganisation,
    makeAccessState,
} from './testing/make-access-state.ts';

describe('resolveLandingRoute', () => {
    it('holds on the root splash while the session is restoring', () => {
        expect(resolveLandingRoute(makeAccessState({ session: 'restoring' }))).toEqual({
            href: ROUTE_PATHS.root,
            reason: 'session_restoring',
        });
    });

    it('sends anonymous users to sign in', () => {
        expect(resolveLandingRoute(makeAccessState({ session: 'anonymous' }))).toEqual({
            href: ROUTE_PATHS.signIn,
            reason: 'unauthenticated',
        });
    });

    it('sends unverified users to email verification', () => {
        expect(resolveLandingRoute(makeAccessState({ emailVerified: false }))).toEqual({
            href: ROUTE_PATHS.verifyEmail,
            reason: 'email_unverified',
        });
    });

    it('sends verified users without an organisation to the organisation picker', () => {
        expect(resolveLandingRoute(makeAccessState({ mode: 'staff' }))).toEqual({
            href: ROUTE_PATHS.selectOrganisation,
            reason: 'no_organisation_context',
        });
    });

    it('treats a non-active membership as no organisation context', () => {
        const state = makeAccessState({
            mode: 'staff',
            organisation: makeAccessOrganisation({ membershipStatus: 'pending' }),
        });
        expect(resolveLandingRoute(state).reason).toBe('no_organisation_context');
    });

    it('sends branch-scoped memberships to the branch picker', () => {
        const state = makeAccessState({
            mode: 'staff',
            organisation: makeAccessOrganisation({ requiresBranchSelection: true }),
        });
        expect(resolveLandingRoute(state)).toEqual({
            href: ROUTE_PATHS.selectBranch,
            reason: 'no_branch_context',
        });
    });

    it('does not force consumer builds through organisation selection', () => {
        expect(resolveLandingRoute(makeAccessState({ mode: 'customer' }))).toEqual({
            href: ROUTE_PATHS.customerHome,
            reason: 'workspace',
        });
    });

    it.each(APP_MODES)('%s lands on its own workspace once fully hydrated', (mode) => {
        const state = makeAccessState({
            mode,
            organisation: makeAccessOrganisation(),
            branch: makeAccessBranch(),
        });
        expect(resolveLandingRoute(state)).toEqual({
            href: MODE_LANDING_PATHS[mode],
            reason: 'workspace',
        });
    });

    it('declares a landing path for every build mode', () => {
        expect(Object.keys(MODE_LANDING_PATHS).sort()).toEqual([...APP_MODES].sort());
        for (const mode of APP_MODES) {
            expect(MODE_LANDING_PATHS[mode].startsWith('/')).toBe(true);
        }
    });
});
