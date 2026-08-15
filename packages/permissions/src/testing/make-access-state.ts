import { BranchId, MembershipId, OrganisationId } from '@healthy360/domain-types';

import type { AccessBranch, AccessOrganisation, AccessState } from '../state.ts';

/**
 * Test builder for `AccessState`.
 *
 * It lives in this package (rather than in `@healthy360/testing`) purely so the guard kernel's own
 * suite can use it without `@healthy360/testing` — which depends on this package — creating a cycle
 * in the Turborepo task graph. `@healthy360/testing` re-exports it, and that is the import path
 * application and package tests should use.
 *
 * All identifiers are fixed constants: fixtures must never be random, or a failing assertion cannot
 * be reproduced from the message alone.
 */
export const FIXTURE_ORGANISATION_ID = OrganisationId.unsafe(
    '01935f6c-0000-7000-8000-00000000a001',
);
export const FIXTURE_OTHER_ORGANISATION_ID = OrganisationId.unsafe(
    '01935f6c-0000-7000-8000-00000000a002',
);
export const FIXTURE_MEMBERSHIP_ID = MembershipId.unsafe('01935f6c-0000-7000-8000-00000000b001');
export const FIXTURE_BRANCH_ID = BranchId.unsafe('01935f6c-0000-7000-8000-00000000c001');

export interface AccessStateOverrides extends Partial<
    Omit<AccessState, 'permissions' | 'entitlements'>
> {
    readonly permissions?: Iterable<string> | undefined;
    readonly entitlements?: Iterable<string> | undefined;
}

export function makeAccessOrganisation(
    overrides: Partial<AccessOrganisation> = {},
): AccessOrganisation {
    return {
        id: FIXTURE_ORGANISATION_ID,
        membershipId: FIXTURE_MEMBERSHIP_ID,
        membershipStatus: 'active',
        requiresBranchSelection: false,
        ...overrides,
    };
}

export function makeAccessBranch(overrides: Partial<AccessBranch> = {}): AccessBranch {
    return {
        id: FIXTURE_BRANCH_ID,
        organisationId: FIXTURE_ORGANISATION_ID,
        ...overrides,
    };
}

/**
 * Defaults to the most permissive *shape* that still proves nothing: `all-dev` mode, an
 * authenticated and verified user, no organisation, no branch, no permissions, no entitlements.
 * Every gate therefore has to be opened explicitly by the test that cares about it.
 */
export function makeAccessState(overrides: AccessStateOverrides = {}): AccessState {
    const { permissions, entitlements, ...rest } = overrides;
    return {
        mode: 'all-dev',
        session: 'authenticated',
        emailVerified: true,
        organisation: undefined,
        branch: undefined,
        // Default true so "no organisation *context*" fixtures still mean "go pick one",
        // not "pure consumer". Tests for consumers with no memberships set this false.
        hasActiveMembership: true,
        ...rest,
        permissions: new Set(permissions ?? []),
        entitlements: new Set(entitlements ?? []),
    };
}

/** An `AccessState` that clears gates 1–5 for the given area's baseline requirement. */
export function makeHydratedAccessState(overrides: AccessStateOverrides = {}): AccessState {
    return makeAccessState({
        organisation: makeAccessOrganisation(),
        branch: makeAccessBranch(),
        ...overrides,
    });
}
