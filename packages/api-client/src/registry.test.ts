import { describe, expect, it } from 'vitest';

import { createMemoryTokenStore } from './contracts/index.ts';
import {
    ApiRepositoriesUnavailableError,
    MockDataInProductionError,
    createRepositories,
} from './registry.ts';
import type { RepositoryAppEnv } from './registry.ts';

const NON_PRODUCTION: readonly RepositoryAppEnv[] = ['development', 'preview'];

describe('createRepositories — mock mode', () => {
    it.each(NON_PRODUCTION)('builds mock repositories in %s', async (appEnv) => {
        const repositories = await createRepositories({
            dataMode: 'mock',
            appEnv,
            scenario: 'single-org-owner',
            latencyMs: 0,
        });

        expect(repositories.auth).toBeDefined();
        expect(repositories.session).toBeDefined();
        expect(repositories.context).toBeDefined();
        expect(repositories.devices).toBeDefined();
    });

    it('honours the requested scenario', async () => {
        const repositories = await createRepositories({
            dataMode: 'mock',
            appEnv: 'development',
            scenario: 'customer-no-org',
            latencyMs: 0,
        });
        await repositories.auth.login({
            email: 'nour.saleh@example.com',
            password: 'password',
        });
        expect((await repositories.session.me()).memberships).toEqual([]);
    });

    it('falls back to the default scenario when the name is unknown', async () => {
        const repositories = await createRepositories({
            dataMode: 'mock',
            appEnv: 'development',
            scenario: 'no-such-scenario' as never,
            latencyMs: 0,
        });
        await repositories.auth.login({
            email: 'layla.haddad@cedarclinic.example',
            password: 'password',
        });
        expect((await repositories.session.me()).memberships.length).toBeGreaterThan(1);
    });

    it('threads the caller-supplied token store through, so a reload can restore', async () => {
        const tokenStore = createMemoryTokenStore();
        const repositories = await createRepositories({
            dataMode: 'mock',
            appEnv: 'development',
            scenario: 'single-org-owner',
            latencyMs: 0,
            tokenStore,
        });

        await repositories.auth.login({
            email: 'omar.khoury@cedarclinic.example',
            password: 'password',
        });
        expect(tokenStore.get()).not.toBeNull();
    });
});

/** Mock-cannot-ship gate #2 (plan §18). Gate #1 lives in `apps/universal/app.config.ts`. */
describe('createRepositories — production refuses mock data', () => {
    it('throws MockDataInProductionError', async () => {
        await expect(
            createRepositories({ dataMode: 'mock', appEnv: 'production' }),
        ).rejects.toBeInstanceOf(MockDataInProductionError);
    });

    it('names both offending settings in the message', async () => {
        const error = await createRepositories({
            dataMode: 'mock',
            appEnv: 'production',
        }).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('appEnv=production');
        expect((error as Error).message).toContain('dataMode=mock');
        expect((error as Error).name).toBe('MockDataInProductionError');
    });

    it('throws before any fixture module is imported', async () => {
        // A rejection that still constructed the mock world would defeat the point of the gate:
        // the scenario name is deliberately valid, so only the guard can be what stopped it.
        await expect(
            createRepositories({
                dataMode: 'mock',
                appEnv: 'production',
                scenario: 'platform-admin',
            }),
        ).rejects.toBeInstanceOf(MockDataInProductionError);
    });
});

describe('createRepositories — api mode', () => {
    it.each(['development', 'preview', 'production'] as const)(
        'is unavailable until Phase 5c in %s',
        async (appEnv) => {
            await expect(
                createRepositories({ dataMode: 'api', appEnv, baseUrl: 'https://api.example' }),
            ).rejects.toBeInstanceOf(ApiRepositoriesUnavailableError);
        },
    );

    it('explains where the implementation is coming from', async () => {
        const error = await createRepositories({ dataMode: 'api', appEnv: 'development' }).catch(
            (caught: unknown) => caught,
        );
        expect((error as Error).message).toContain('Phase 5c');
    });
});
