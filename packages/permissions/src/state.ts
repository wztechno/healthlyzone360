import type {
    AppMode,
    BranchId,
    MembershipId,
    MembershipStatus,
    OrganisationId,
    SessionState,
} from '@healthy360/domain-types';

/**
 * The organisation slice of the access state. Present only once the *server* has confirmed an
 * organisation context — a client-selected identifier is never enough (plan §9).
 */
export interface AccessOrganisation {
    readonly id: OrganisationId;
    readonly membershipId: MembershipId;
    readonly membershipStatus: MembershipStatus;
    /** True when this membership is branch-scoped and therefore requires a branch selection. */
    readonly requiresBranchSelection: boolean;
}

export interface AccessBranch {
    readonly id: BranchId;
    readonly organisationId: OrganisationId;
}

/**
 * Everything the guard kernel is allowed to look at. It is a plain, serialisable snapshot: no
 * functions, no promises, no framework objects, so it can be built in a test in one line.
 */
export interface AccessState {
    /** Build-time application mode (plan §16). */
    readonly mode: AppMode;
    readonly session: SessionState;
    readonly emailVerified: boolean;
    readonly organisation?: AccessOrganisation | undefined;
    readonly branch?: AccessBranch | undefined;
    /** Effective permission keys for (user × organisation × branch), e.g. `organisation.view_current`. */
    readonly permissions: ReadonlySet<string>;
    /** Effective feature entitlement keys, e.g. `module.kitchen`. */
    readonly entitlements: ReadonlySet<string>;
}

/** The three session states, restated locally so consumers need not reach into domain-types. */
export type { SessionState };

export function hasOrganisationContext(state: AccessState): boolean {
    return state.organisation !== undefined && state.organisation.membershipStatus === 'active';
}

export function hasBranchContext(state: AccessState): boolean {
    if (state.branch === undefined) return false;
    if (state.organisation === undefined) return false;
    return state.branch.organisationId === state.organisation.id;
}
