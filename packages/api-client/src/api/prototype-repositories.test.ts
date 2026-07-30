import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { asApiFailure } from '../contracts/failure.ts';
import { createMemoryTokenStore } from '../contracts/session.ts';
import { describeRepositoryContract } from '../mock/prototype/repository-contract.ts';
import {
    API_PROTOTYPE_REPOSITORIES,
    PROTOTYPE_ENDPOINTS,
    apiMarketplaceRepository,
} from './prototype-repositories.ts';
import { createApiRepositories } from './repositories.ts';

/**
 * The API bundle, run against the same contract as the mock.
 *
 * Everything here rejects, and that is the point: the eight Prompt 2 contracts describe endpoints
 * that do not exist. What is being asserted is that the *surface* is identical, that every method
 * fails in the same, nameable way, and that the fixture world has not crept into the api-mode chunk.
 */
describeRepositoryContract({
    name: 'api bundle',
    mode: 'api',
    create: () => API_PROTOTYPE_REPOSITORIES,
});

describe('the api bundle exposes the prototype repositories', () => {
    it('createApiRepositories returns all eight alongside the foundation four', () => {
        const repositories = createApiRepositories({
            baseUrl: 'https://api.example',
            tokenStore: createMemoryTokenStore(),
        });

        expect(repositories.marketplace).toBe(API_PROTOTYPE_REPOSITORIES.marketplace);
        expect(repositories.nutrition).toBe(API_PROTOTYPE_REPOSITORIES.nutrition);
        expect(repositories.planner).toBe(API_PROTOTYPE_REPOSITORIES.planner);
        expect(repositories.foods).toBe(API_PROTOTYPE_REPOSITORIES.foods);
        expect(repositories.virtualDietitian).toBe(API_PROTOTYPE_REPOSITORIES.virtualDietitian);
        expect(repositories.commerce).toBe(API_PROTOTYPE_REPOSITORIES.commerce);
        expect(repositories.business).toBe(API_PROTOTYPE_REPOSITORIES.business);
        expect(repositories.professional).toBe(API_PROTOTYPE_REPOSITORIES.professional);
    });

    /**
     * A rejected promise, not a synchronous throw. A caller writing `.catch()` without a `try` must
     * get the failure, exactly as it would from any other repository in this package.
     */
    it('rejects rather than throwing synchronously', async () => {
        // Captured rather than discarded: an unawaited rejected promise is an unhandled rejection,
        // which is exactly the failure mode this assertion is about.
        const started: Promise<unknown>[] = [];
        expect(() => started.push(apiMarketplaceRepository.listKitchens())).not.toThrow();
        await expect(started[0]).rejects.toBeInstanceOf(Error);
    });

    it('names the endpoint it would have called', async () => {
        const failure = await apiMarketplaceRepository
            .listKitchens()
            .then(() => null, asApiFailure);
        expect(failure?.message).toContain(PROTOTYPE_ENDPOINTS.listKitchens);
    });

    it('gives every endpoint in the table a distinct method and verb', () => {
        const endpoints = Object.values(PROTOTYPE_ENDPOINTS);
        expect(new Set(endpoints).size).toBe(endpoints.length);
        for (const endpoint of endpoints) {
            expect(endpoint).toMatch(/^(GET|POST|PUT|PATCH|DELETE) \/api\/v1\//);
        }
    });
});

/**
 * **The import graph.**
 *
 * The fixture world is large — sixty ingredients, twenty recipes rolled up through the nutrition
 * package, forty meals with fourteen days of availability each — and it exists only for mock mode.
 * `createRepositories` keeps the two implementations behind separate dynamic imports so a build can
 * split them; that split is worth nothing if a file under `src/api/` reaches into `src/mock/`.
 *
 * Asserted by reading the source rather than by inspecting a bundle, because it has to fail in the
 * unit suite, on the commit that introduces it, rather than in a bundle-size report later.
 */
describe('the api chunk does not import the fixture world', () => {
    const API_DIR = fileURLToPath(new URL('.', import.meta.url));

    const sources = readdirSync(API_DIR).filter(
        (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
    );

    it('has source files to check', () => {
        expect(sources.length).toBeGreaterThan(4);
    });

    /**
     * The package root re-exports the scenario *names* so the development banner and the Playwright
     * harness can list them without pulling the world they describe. That only holds while
     * `mock/scenarios.ts` itself stays free of the prototype subtree.
     */
    it('keeps the scenario list free of the prototype fixtures', () => {
        const scenarios = readFileSync(
            fileURLToPath(new URL('../mock/scenarios.ts', import.meta.url)),
            'utf8',
        );
        // Import specifiers only: the prose above the scenarios legitimately points at the store.
        const imports = [...scenarios.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
        expect(imports.filter((specifier) => specifier.includes('prototype'))).toEqual([]);
    });

    it.each(sources)('%s imports nothing from ../mock', (file) => {
        const content = readFileSync(`${API_DIR}${file}`, 'utf8');
        const imports = [...content.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
        const offenders = imports.filter((specifier) => specifier.includes('mock'));
        expect(offenders, `${file} reaches into the mock world`).toEqual([]);
    });
});
