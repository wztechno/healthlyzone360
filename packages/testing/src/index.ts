/**
 * `makeAccessState` and friends physically live in `@healthy360/permissions/testing` so the guard
 * kernel's own suite can use them without a dependency cycle. This is their canonical import path.
 */
export {
    FIXTURE_BRANCH_ID,
    FIXTURE_MEMBERSHIP_ID,
    FIXTURE_ORGANISATION_ID,
    FIXTURE_OTHER_ORGANISATION_ID,
    makeAccessBranch,
    makeAccessOrganisation,
    makeAccessState,
    makeHydratedAccessState,
} from '@healthy360/permissions/testing';
export type { AccessStateOverrides } from '@healthy360/permissions/testing';

export {
    FIXTURE_CREATED_AT,
    FIXTURE_IDS,
    FIXTURE_NOW,
    makeActiveContext,
    makeBranch,
    makeDevice,
    makeMembership,
    makeMembershipRole,
    makeOrganisation,
    makeProfile,
    makeSessionUser,
} from './fixtures.ts';
