import type { MeResponse } from '@healthy360/api-client';
import {
    makeActiveContext,
    makeMembership,
    makeOrganisation,
    makeProfile,
    makeSessionUser,
} from '@healthy360/testing';

import { accountIdentity } from './account-identity.ts';

function me(overrides: Partial<MeResponse> = {}): MeResponse {
    return {
        user: makeSessionUser(),
        profile: makeProfile({ displayName: 'Hala Haddad' }),
        memberships: [makeMembership()],
        activeContext: makeActiveContext(),
        pendingConsents: [],
        ...overrides,
    };
}

describe('accountIdentity', () => {
    it('names the person, then the role and the branch they are working in', () => {
        expect(accountIdentity(me())).toEqual({
            name: 'Hala Haddad',
            detail: 'Clinic dietitian · Beirut Central',
        });
    });

    it('falls back to the organisation when the membership is organisation-wide', () => {
        expect(
            accountIdentity(
                me({
                    memberships: [
                        makeMembership({
                            branches: [],
                            organisation: makeOrganisation({ name: 'Cedar Kitchen' }),
                        }),
                    ],
                    activeContext: makeActiveContext({ branchId: null }),
                }),
            ).detail,
        ).toBe('Clinic dietitian · Cedar Kitchen');
    });

    it('says nothing it does not know', () => {
        expect(accountIdentity(me({ activeContext: null }))).toEqual({
            name: 'Hala Haddad',
            detail: undefined,
        });
        expect(accountIdentity(null)).toEqual({ name: '', detail: undefined });
    });
});
