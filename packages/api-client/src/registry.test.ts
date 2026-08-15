import { describe, expect, it } from 'vitest';

import type { ApiRepositories } from './api/index.ts';
import { createMemoryTokenStore } from './contracts/index.ts';
import { MissingApiBaseUrlError, createRepositories } from './registry.ts';

describe('createRepositories', () => {
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
