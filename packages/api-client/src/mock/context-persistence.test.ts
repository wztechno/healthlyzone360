import { describe, expect, it } from 'vitest';

import { createMemoryTokenStore } from '../contracts/session.ts';
import { createMockRepositories } from './repositories.ts';

describe('context persistence across me() refetches', () => {
    it('me() returns the context stored by setContext()', async () => {
        const tokenStore = createMemoryTokenStore();
        const repositories = createMockRepositories({
            scenario: 'multi-org-dietitian',
            tokenStore,
        });

        const login = await repositories.auth.login({
            email: 'layla.haddad@cedarclinic.example',
            password: 'password',
        });
        expect(login.status).toBe('authenticated');

        const before = await repositories.session.me();
        expect(before.activeContext).toBeNull();

        const cedar = before.memberships.find((m) => m.organisation.slug === 'cedar-clinic');
        expect(cedar).toBeDefined();

        const applied = await repositories.context.setContext({
            organisationId: cedar!.organisation.id,
        });
        expect(applied.organisationId).toBe(cedar!.organisation.id);

        const after = await repositories.session.me();
        expect(after.activeContext).not.toBeNull();
        expect(after.activeContext?.organisationId).toBe(cedar!.organisation.id);
    });
});
