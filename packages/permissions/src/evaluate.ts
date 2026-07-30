import type { RouteArea } from '@healthy360/domain-types';

import { missingEntitlements, missingPermissions } from './can.ts';
import { modeAllows } from './modes.ts';
import { ROUTE_PATHS, ROUTE_REQUIREMENTS } from './requirements.ts';
import type { RouteRequirement } from './requirements.ts';
import { hasBranchContext, hasOrganisationContext } from './state.ts';
import type { AccessState } from './state.ts';

/** The seven gates, in evaluation order (plan §17). The order is load-bearing. */
export const GATES = [
    'mode',
    'authentication',
    'email_verification',
    'organisation',
    'branch',
    'entitlement',
    'permission',
] as const;
export type Gate = (typeof GATES)[number];

/**
 * Stable machine-readable denial reasons. These strings are part of the package's public
 * contract: tests assert them and the forbidden page maps them to translated copy
 * (`access:denial.<reason>`). Never rename one without a coordinated i18n change.
 */
export const DENIAL_REASONS = [
    'mode_excluded',
    'unauthenticated',
    'email_unverified',
    'no_organisation_context',
    'no_branch_context',
    'entitlement_missing',
    'permission_missing',
] as const;
export type DenialReason = (typeof DENIAL_REASONS)[number];

/** Which gate produces which reason. Exported so the mapping can be asserted directly. */
export const GATE_DENIAL_REASON: Readonly<Record<Gate, DenialReason>> = {
    mode: 'mode_excluded',
    authentication: 'unauthenticated',
    email_verification: 'email_unverified',
    organisation: 'no_organisation_context',
    branch: 'no_branch_context',
    entitlement: 'entitlement_missing',
    permission: 'permission_missing',
};

export type GateResult =
    /** Every gate passed. */
    | { readonly status: 'allow' }
    /** The answer is not knowable yet (session restoration in flight). Render a splash, not a denial. */
    | { readonly status: 'pending'; readonly gate: Gate }
    /** The user can fix this by going somewhere else (sign in, verify, pick a context). */
    | {
          readonly status: 'redirect';
          readonly gate: Gate;
          readonly href: string;
          readonly reason: DenialReason;
      }
    /** The user cannot fix this from the client. Render the forbidden page. */
    | {
          readonly status: 'deny';
          readonly gate: Gate;
          readonly reason: DenialReason;
          /** Entitlement or permission keys that were absent, for actionable messaging. */
          readonly missing?: readonly string[];
      };

const ALLOW: GateResult = { status: 'allow' };

function isNonEmpty(keys: readonly string[] | undefined): keys is readonly string[] {
    return keys !== undefined && keys.length > 0;
}

/**
 * Requiring email verification, an organisation, a branch, an entitlement or a permission all
 * implicitly require authentication — otherwise a misconfigured requirement would skip the
 * authentication gate and produce a confusing downstream denial.
 */
function authenticationRequired(requirement: RouteRequirement): boolean {
    return (
        requirement.requiresAuth === true ||
        requirement.requiresVerifiedEmail === true ||
        requirement.requiresOrg === true ||
        requirement.requiresBranch === true ||
        isNonEmpty(requirement.entitlements) ||
        isNonEmpty(requirement.allOf) ||
        isNonEmpty(requirement.anyOf)
    );
}

/**
 * A branch is demanded either because the route says so (kitchen, POS, KDS) or because the active
 * membership is itself branch-scoped and no branch has been confirmed yet.
 */
function branchRequired(state: AccessState, requirement: RouteRequirement): boolean {
    if (requirement.requiresBranch === true) return true;
    return requirement.requiresOrg === true && state.organisation?.requiresBranchSelection === true;
}

/**
 * Runs the seven gates in the fixed plan §17 order and returns the first non-allow outcome.
 *
 * Client guards improve UX only; Laravel remains authoritative (05-universal-frontend.md §5.3).
 */
export function evaluateGates(state: AccessState, requirement: RouteRequirement): GateResult {
    // 1 — build / application mode.
    if (!modeAllows(state.mode, requirement.area)) {
        return { status: 'deny', gate: 'mode', reason: 'mode_excluded' };
    }

    // 2 — authentication.
    if (authenticationRequired(requirement)) {
        if (state.session === 'restoring') {
            return { status: 'pending', gate: 'authentication' };
        }
        if (state.session !== 'authenticated') {
            return {
                status: 'redirect',
                gate: 'authentication',
                href: ROUTE_PATHS.signIn,
                reason: 'unauthenticated',
            };
        }
    }

    // 3 — email verification.
    if (requirement.requiresVerifiedEmail === true && !state.emailVerified) {
        return {
            status: 'redirect',
            gate: 'email_verification',
            href: ROUTE_PATHS.verifyEmail,
            reason: 'email_unverified',
        };
    }

    // 4 — organisation context.
    if (requirement.requiresOrg === true && !hasOrganisationContext(state)) {
        return {
            status: 'redirect',
            gate: 'organisation',
            href: ROUTE_PATHS.selectOrganisation,
            reason: 'no_organisation_context',
        };
    }

    // 5 — branch context.
    if (branchRequired(state, requirement) && !hasBranchContext(state)) {
        return {
            status: 'redirect',
            gate: 'branch',
            href: ROUTE_PATHS.selectBranch,
            reason: 'no_branch_context',
        };
    }

    // 6 — feature entitlement.
    if (isNonEmpty(requirement.entitlements)) {
        const missing = missingEntitlements(state, requirement.entitlements);
        if (missing.length > 0) {
            return { status: 'deny', gate: 'entitlement', reason: 'entitlement_missing', missing };
        }
    }

    // 7 — required permission.
    if (isNonEmpty(requirement.allOf)) {
        const missing = missingPermissions(state, requirement.allOf);
        if (missing.length > 0) {
            return { status: 'deny', gate: 'permission', reason: 'permission_missing', missing };
        }
    }
    if (isNonEmpty(requirement.anyOf)) {
        const satisfied = requirement.anyOf.some((key) => state.permissions.has(key));
        if (!satisfied) {
            return {
                status: 'deny',
                gate: 'permission',
                reason: 'permission_missing',
                missing: requirement.anyOf,
            };
        }
    }

    return ALLOW;
}

/** Convenience wrapper: evaluate an area against its registry baseline. */
export function evaluateArea(state: AccessState, area: RouteArea): GateResult {
    return evaluateGates(state, ROUTE_REQUIREMENTS[area]);
}

export function isAllowed(result: GateResult): boolean {
    return result.status === 'allow';
}

/** `pending` is not a denial — callers must render a restoring state rather than a refusal. */
export function isPending(result: GateResult): boolean {
    return result.status === 'pending';
}

export function denialReason(result: GateResult): DenialReason | null {
    return result.status === 'redirect' || result.status === 'deny' ? result.reason : null;
}
