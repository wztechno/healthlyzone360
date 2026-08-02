import { describe, expect, it } from 'vitest';

import type { ApiRepositories } from './api/index.ts';
import { createMemoryTokenStore } from './contracts/index.ts';
import {
    MissingApiBaseUrlError,
    MockDataInProductionError,
    createRepositories,
} from './registry.ts';
import type { RepositoryAppEnv } from './registry.ts';

const NON_PRODUCTION: readonly RepositoryAppEnv[] = ['development', 'preview'];

/**
 * Mock mode pays for a **cold dynamic import of the entire fixture world** — sixty ingredients,
 * twenty recipes rolled up through the nutrition package, forty meals, and since K1 the mutable
 * kitchen catalogue on top. That is the code split working as designed, and it is what these tests
 * exist to prove is reachable; but it is transform-and-import work, not test work, and Vitest's
 * five-second default is sized for the latter. Under `turbo run ... test` every package's workers
 * compete for the same cores and the import alone has been measured above five seconds.
 *
 * The generous ceiling is therefore on the *import*, not on any behaviour: every assertion below
 * still runs in single-digit milliseconds once the chunk is loaded.
 */
const MOCK_IMPORT_TIMEOUT_MS = 30_000;

describe('createRepositories — mock mode', { timeout: MOCK_IMPORT_TIMEOUT_MS }, () => {
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
        'builds API repositories in %s',
        async (appEnv) => {
            const repositories = await createRepositories({
                dataMode: 'api',
                appEnv,
                baseUrl: 'https://api.example',
            });

            expect(repositories.auth).toBeDefined();
            expect(repositories.session).toBeDefined();
            expect(repositories.context).toBeDefined();
            expect(repositories.devices).toBeDefined();
        },
    );

    it('defaults to the local API outside production', async () => {
        const repositories = (await createRepositories({
            dataMode: 'api',
            appEnv: 'development',
        })) as ApiRepositories;

        expect(repositories.kind).toBe('api');
    });

    /** Guessing `localhost` in production would be a silent outage, not a convenience. */
    it('refuses to guess a base URL in production', async () => {
        await expect(
            createRepositories({ dataMode: 'api', appEnv: 'production' }),
        ).rejects.toBeInstanceOf(MissingApiBaseUrlError);
    });

    it('threads the caller-supplied token store through', async () => {
        const tokenStore = createMemoryTokenStore('existing-token');
        const repositories = (await createRepositories({
            dataMode: 'api',
            appEnv: 'development',
            baseUrl: 'https://api.example',
            tokenStore,
        })) as ApiRepositories;

        expect(repositories.transport.tokenStore.get()).toBe('existing-token');
    });
});
