import { ID_CODECS, isUuid } from '@healthy360/domain-types';
import { evaluateGates } from '@healthy360/permissions';
import { describe, expect, it } from 'vitest';

import {
    FIXTURE_IDS,
    makeAccessBranch,
    makeAccessOrganisation,
    makeAccessState,
    makeActiveContext,
    makeBranch,
    makeDevice,
    makeHydratedAccessState,
    makeMembership,
    makeOrganisation,
    makeProfile,
    makeSessionUser,
} from './index.ts';

describe('fixture identifiers', () => {
    it('are all valid UUIDv7-shaped strings', () => {
        for (const [name, id] of Object.entries(FIXTURE_IDS)) {
            expect(isUuid(id), `${name} should be a valid uuid`).toBe(true);
        }
    });

    it('are unique', () => {
        const values = Object.values(FIXTURE_IDS);
        expect(new Set(values).size).toBe(values.length);
    });

    it('parse through the domain-types codecs', () => {
        expect(ID_CODECS.UserId.parse(FIXTURE_IDS.user)).toBe(FIXTURE_IDS.user);
        expect(ID_CODECS.BranchId.parse(FIXTURE_IDS.branch)).toBe(FIXTURE_IDS.branch);
    });
});

describe('fixture factories', () => {
    const factories = [
        ['makeProfile', makeProfile],
        ['makeSessionUser', makeSessionUser],
        ['makeOrganisation', makeOrganisation],
        ['makeBranch', makeBranch],
        ['makeMembership', makeMembership],
        ['makeDevice', makeDevice],
        ['makeActiveContext', makeActiveContext],
    ] as const;

    it.each(factories)('%s is deterministic across calls', (_name, factory) => {
        expect(factory()).toEqual(factory());
    });

    it.each(factories)('%s returns a fresh object each call', (_name, factory) => {
        expect(factory()).not.toBe(factory());
    });

    it('applies overrides', () => {
        expect(makeOrganisation({ name: 'Gulf Kitchens' }).name).toBe('Gulf Kitchens');
        expect(makeMembership({ status: 'suspended' }).status).toBe('suspended');
        expect(makeDevice({ platform: 'android' }).platform).toBe('android');
    });

    it('wires the branch to its organisation', () => {
        const membership = makeMembership();
        expect(membership.branches[0]?.organisationId).toBe(membership.organisation.id);
    });

    it('produces an active context consistent with the membership fixture', () => {
        const context = makeActiveContext();
        expect(context.organisationId).toBe(FIXTURE_IDS.organisation);
        expect(context.branchId).toBe(FIXTURE_IDS.branch);
        expect(context.membershipId).toBe(FIXTURE_IDS.membership);
    });
});

describe('makeAccessState', () => {
    it('defaults to an authenticated, verified user with nothing granted', () => {
        const state = makeAccessState();
        expect(state.mode).toBe('all-dev');
        expect(state.session).toBe('authenticated');
        expect(state.emailVerified).toBe(true);
        expect(state.organisation).toBeUndefined();
        expect(state.branch).toBeUndefined();
        expect(state.permissions.size).toBe(0);
        expect(state.entitlements.size).toBe(0);
    });

    it('accepts iterables for permissions and entitlements', () => {
        const state = makeAccessState({
            permissions: ['a.read'],
            entitlements: new Set(['feature.api_access']),
        });
        expect(state.permissions.has('a.read')).toBe(true);
        expect(state.entitlements.has('feature.api_access')).toBe(true);
    });

    it('produces states the guard kernel accepts', () => {
        expect(evaluateGates(makeAccessState(), { area: 'auth' })).toEqual({ status: 'allow' });
        expect(
            evaluateGates(makeHydratedAccessState(), { area: 'clinic', requiresOrg: true }),
        ).toEqual({ status: 'allow' });
        expect(evaluateGates(makeAccessState(), { area: 'clinic', requiresOrg: true }).status).toBe(
            'redirect',
        );
    });

    it('builds a matching organisation/branch pair by default', () => {
        expect(makeAccessBranch().organisationId).toBe(makeAccessOrganisation().id);
    });
});
