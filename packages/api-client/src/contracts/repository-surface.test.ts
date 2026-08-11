import { describe, expect, it } from 'vitest';

import { createApiRepositories } from '../api/repositories.ts';
import { createMemoryTokenStore } from './session.ts';
import {
    REPOSITORY_SURFACE,
    REPOSITORY_SURFACE_KEYS,
    REPOSITORY_SURFACE_METHOD_COUNT,
} from './repository-surface.ts';

/**
 * The runtime half of the surface table's guarantee.
 *
 * `satisfies` already proves every listed name is a real contract method; what it cannot prove is
 * that the table is *complete* — a method added to a contract and implemented without being
 * recorded here would silently escape the stub factory and the drift check. Building the api
 * bundle costs nothing (no request leaves the transport at construction), so the cheapest complete
 * proof is to compare the real thing.
 */
describe('the repository surface table matches the api bundle', () => {
    const repositories = createApiRepositories({
        baseUrl: 'https://api.example',
        tokenStore: createMemoryTokenStore(),
    });

    it.each([...REPOSITORY_SURFACE_KEYS])('%s exposes exactly the recorded methods', (key) => {
        const actual = Object.entries(repositories[key])
            .filter(([, member]) => typeof member === 'function')
            .map(([name]) => name)
            .sort();
        expect(actual).toEqual([...REPOSITORY_SURFACE[key]].sort());
    });

    it('covers every repository field of the bundle', () => {
        const bundleKeys = Object.keys(repositories)
            .filter((key) => key !== 'kind' && key !== 'transport')
            .sort();
        expect(bundleKeys).toEqual([...REPOSITORY_SURFACE_KEYS].sort());
    });

    it('counts the whole surface', () => {
        expect(REPOSITORY_SURFACE_METHOD_COUNT).toBe(
            REPOSITORY_SURFACE_KEYS.reduce(
                (total, key) => total + REPOSITORY_SURFACE[key].length,
                0,
            ),
        );
    });
});
