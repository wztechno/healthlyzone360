import { describe, expect, it } from 'vitest';

import type { ApiRepositories } from './api/index.ts';
import { createMemoryTokenStore } from './contracts/index.ts';
import { MissingApiBaseUrlError, createRepositories } from './registry.ts';

describe('createRepositories', () => {
    /**
     * The explicit timeout is not padding, and it is not hiding a slow unit.
     *
     * `createRepositories` resolves the API layer through a dynamic `import()`, so the *first* case
     * here pays the module's cold transform and every later one pays nothing — measured at 939ms
     * against 0ms on an idle machine. Vitest's 5s default left about four seconds of headroom,
     * which this package shares with ten others under `turbo run test`; two of them are Jest
     * projects with their own workers. That was enough to miss the deadline intermittently, and a
     * suite that fails on machine load rather than on behaviour tells you nothing when it goes red.
     */
    it.each(['development', 'preview', 'production'] as const)(
        'builds API repositories in %s',
        async (appEnv) => {
            const repositories = await createRepositories({
                appEnv,
                baseUrl: 'https://api.example',
            });

            expect(repositories.auth).toBeDefined();
            expect(repositories.session).toBeDefined();
            expect(repositories.context).toBeDefined();
            expect(repositories.devices).toBeDefined();
        },
        30_000,
    );

    it('defaults to the local API outside production', async () => {
        const repositories = (await createRepositories({
            appEnv: 'development',
        })) as ApiRepositories;

        expect(repositories.kind).toBe('api');
    });

    /** Guessing `localhost` in production would be a silent outage, not a convenience. */
    it('refuses to guess a base URL in production', async () => {
        await expect(createRepositories({ appEnv: 'production' })).rejects.toBeInstanceOf(
            MissingApiBaseUrlError,
        );
    });

    it('names the missing setting in the message', async () => {
        const error = await createRepositories({ appEnv: 'production' }).catch(
            (caught: unknown) => caught,
        );

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('EXPO_PUBLIC_API_URL');
        expect((error as Error).name).toBe('MissingApiBaseUrlError');
    });

    it('threads the caller-supplied token store through', async () => {
        const tokenStore = createMemoryTokenStore('existing-token');
        const repositories = (await createRepositories({
            appEnv: 'development',
            baseUrl: 'https://api.example',
            tokenStore,
        })) as ApiRepositories;

        expect(repositories.transport.tokenStore.get()).toBe('existing-token');
    });
});
