import { REPOSITORY_SURFACE_METHOD_COUNT } from '@healthy360/api-client';

import {
    StubNotConfiguredError,
    createStubRepositories,
    page,
    sequence,
} from './stub-repositories.ts';

describe('createStubRepositories', () => {
    it('builds the full bundle with kind api', () => {
        const repositories = createStubRepositories();
        expect(repositories.kind).toBe('api');
        expect(typeof repositories.marketplace.listMeals).toBe('function');
        expect(typeof repositories.kitchenOps.listStockItems).toBe('function');
        expect(REPOSITORY_SURFACE_METHOD_COUNT).toBeGreaterThan(200);
    });

    it('rejects unstubbed methods immediately, naming the surface', async () => {
        const repositories = createStubRepositories();
        await expect(repositories.commerce.getCart()).rejects.toThrow(StubNotConfiguredError);
        await expect(repositories.commerce.getCart()).rejects.toThrow('commerce.getCart');
    });

    it('runs provided overrides and records calls as jest mocks', async () => {
        const repositories = createStubRepositories({
            marketplace: { listMeals: async () => page([]) },
        });

        const result = await repositories.marketplace.listMeals({ limit: 5 });
        expect(result.items).toEqual([]);
        expect(repositories.marketplace.listMeals).toHaveBeenCalledWith({ limit: 5 });
    });

    it('applies latency to stubbed methods only', async () => {
        const repositories = createStubRepositories(
            { marketplace: { listMeals: async () => page([]) } },
            { latencyMs: 20 },
        );

        const started = Date.now();
        await repositories.marketplace.listMeals({});
        expect(Date.now() - started).toBeGreaterThanOrEqual(15);

        const failedFast = Date.now();
        await expect(repositories.marketplace.listKitchens({})).rejects.toThrow(
            StubNotConfiguredError,
        );
        expect(Date.now() - failedFast).toBeLessThan(15);
    });

    it('throws on an override that names a method the contract does not declare', () => {
        expect(() =>
            createStubRepositories({
                marketplace: { listMealz: async () => page([]) } as never,
            }),
        ).toThrow('marketplace.listMealz is not a contract method');
    });
});

describe('sequence', () => {
    it('answers step by step, then rejects past the end', async () => {
        const step = sequence<'a' | 'b'>('a', 'b');
        await expect(step()).resolves.toBe('a');
        await expect(step()).resolves.toBe('b');
        await expect(step()).rejects.toThrow(StubNotConfiguredError);
    });

    it('treats an Error step as a rejection', async () => {
        const step = sequence<string>(new Error('rate limited'), 'ok');
        await expect(step()).rejects.toThrow('rate limited');
        await expect(step()).resolves.toBe('ok');
    });
});

describe('page', () => {
    it('shapes a single page with derived hasMore and totalCount', () => {
        expect(page(['x', 'y'])).toEqual({
            items: ['x', 'y'],
            nextCursor: null,
            hasMore: false,
            totalCount: 2,
        });
        expect(page(['x'], { nextCursor: 'c2', totalCount: 9 })).toEqual({
            items: ['x'],
            nextCursor: 'c2',
            hasMore: true,
            totalCount: 9,
        });
    });
});
