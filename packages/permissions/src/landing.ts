import type { AppMode } from '@healthy360/domain-types';

import { ROUTE_PATHS } from './requirements.ts';
import { hasBranchContext, hasOrganisationContext } from './state.ts';
import type { AccessState } from './state.ts';

/** Why the landing resolver sent the user where it did. Stable, testable strings. */
export const LANDING_REASONS = [
    'session_restoring',
    'unauthenticated',
    'email_unverified',
    'no_organisation_context',
    'no_branch_context',
    'workspace',
] as const;
export type LandingReason = (typeof LANDING_REASONS)[number];

export interface LandingRoute {
    readonly href: string;
    readonly reason: LandingReason;
}

/** Where each build family sends a fully hydrated user. */
export const MODE_LANDING_PATHS: Readonly<Record<AppMode, string>> = {
    customer: ROUTE_PATHS.customerHome,
    staff: ROUTE_PATHS.workspace,
    kiosk: ROUTE_PATHS.posHome,
    driver: ROUTE_PATHS.driverHome,
    'all-dev': ROUTE_PATHS.workspace,
};

/**
 * Resolves the first screen a launching application should show. Mirrors the gate order of
 * `evaluateGates` so the two never disagree: restore → sign in → verify → organisation → branch →
 * the build family's workspace.
 *
 * The `customer` family is intentionally *not* forced through organisation selection here: a
 * consumer who is authenticated and verified lands on the customer home, and any organisation-bound
 * screen inside it is still gated by `ROUTE_REQUIREMENTS`.
 *
 * In `all-dev`, a verified person with **no active memberships** is treated the same way — they
 * are a pure consumer and must not see the organisation picker empty state.
 */
export function resolveLandingRoute(state: AccessState): LandingRoute {
    if (state.session === 'restoring') {
        return { href: ROUTE_PATHS.root, reason: 'session_restoring' };
    }
    if (state.session !== 'authenticated') {
        return { href: ROUTE_PATHS.signIn, reason: 'unauthenticated' };
    }
    if (!state.emailVerified) {
        return { href: ROUTE_PATHS.verifyEmail, reason: 'email_unverified' };
    }
    if (state.mode !== 'customer' && !hasOrganisationContext(state)) {
        if (state.mode === 'all-dev' && !state.hasActiveMembership) {
            return { href: ROUTE_PATHS.customerHome, reason: 'workspace' };
        }
        return { href: ROUTE_PATHS.selectOrganisation, reason: 'no_organisation_context' };
    }
    if (state.organisation?.requiresBranchSelection === true && !hasBranchContext(state)) {
        return { href: ROUTE_PATHS.selectBranch, reason: 'no_branch_context' };
    }
    return { href: MODE_LANDING_PATHS[state.mode], reason: 'workspace' };
}
