export type { AccessBranch, AccessOrganisation, AccessState, SessionState } from './state.ts';
export { hasBranchContext, hasOrganisationContext } from './state.ts';

export { MODE_ROUTE_AREAS, modeAllows, modesForArea } from './modes.ts';

export {
    ALL_ROUTE_REQUIREMENTS,
    FEATURE_CODES,
    ROUTE_PATHS,
    ROUTE_REQUIREMENTS,
    isFeatureCode,
    mergeRequirements,
    requirementForArea,
} from './requirements.ts';
export type { FeatureCode, RoutePath, RouteRequirement } from './requirements.ts';

export { can, hasEntitlements, missingEntitlements, missingPermissions } from './can.ts';
export type { PermissionMatch } from './can.ts';

export {
    DENIAL_REASONS,
    GATES,
    GATE_DENIAL_REASON,
    denialReason,
    evaluateArea,
    evaluateGates,
    isAllowed,
    isPending,
} from './evaluate.ts';
export type { DenialReason, Gate, GateResult } from './evaluate.ts';

export { LANDING_REASONS, MODE_LANDING_PATHS, resolveLandingRoute } from './landing.ts';
export type { LandingReason, LandingRoute } from './landing.ts';
