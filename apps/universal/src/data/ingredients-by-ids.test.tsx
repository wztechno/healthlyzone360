import { createMemoryTokenStore } from '@healthy360/api-client';
import type { Repositories } from '@healthy360/api-client';
import type { IngredientAdmin } from '@healthy360/api-client/contracts';
import { IngredientId } from '@healthy360/domain-types';
import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';

import { AppProviders } from '../providers.tsx';
import { createStubRepositories } from '../testing/stub-repositories.ts';
import { TEST_METRICS } from '../testing/stub-screen.tsx';
import { useIngredientsByIds } from './kitchen-admin-hooks.ts';
import type { IngredientsByIds } from './kitchen-admin-hooks.ts';
import { queryKeys } from './query-keys.ts';

/**
 * `useIngredientsByIds`: one request for the set, every row written into its per-id entry, and the
 * three outcomes — still resolving, failed, answered without some — told apart rather than dropped.
 */

const A = IngredientId.unsafe('0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e0a01');
const B = IngredientId.unsafe('0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e0a02');
const C = IngredientId.unsafe('0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e0a03');

function row(id: IngredientId): IngredientAdmin {
    return { id, name: { en: String(id), ar: String(id) } } as unknown as IngredientAdmin;
}

let latest: IngredientsByIds | null = null;

function Probe({ ids }: { readonly ids: readonly IngredientId[] }) {
    const result = useIngredientsByIds(ids);
    useEffect(() => {
        latest = result;
    });
    return <Text testID="probe-status">{result.status}</Text>;
}

async function mount(
    ids: readonly IngredientId[],
    getIngredientsByIds: Repositories['kitchenAdmin']['getIngredientsByIds'],
) {
    const repositories = createStubRepositories(
        { kitchenAdmin: { getIngredientsByIds } },
        { latencyMs: 10 },
    );
    // `gcTime` kept: the seeded per-id entries have no observer here, and the harness default of 0
    // would collect them before they could be read back.
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: Infinity } },
    });
    await render(
        <AppProviders
            initialMetrics={TEST_METRICS}
            repositories={repositories}
            tokenStore={createMemoryTokenStore(null)}
            queryClient={queryClient}
            initialOnline
        >
            <Probe ids={ids} />
        </AppProviders>,
    );
    return { repositories, queryClient };
}

async function untilStatus(status: IngredientsByIds['status']) {
    await waitFor(() => {
        expect(screen.getByTestId('probe-status')).toHaveTextContent(status);
    });
}

describe('useIngredientsByIds', () => {
    beforeEach(() => {
        latest = null;
    });

    it('resolves the set in one call and seeds every per-id entry', async () => {
        const { repositories, queryClient } = await mount([B, A, B], async (ids) => ids.map(row));

        expect(latest?.status).toBe('pending');
        await untilStatus('success');

        const call = repositories.kitchenAdmin.getIngredientsByIds as jest.Mock;
        expect(call).toHaveBeenCalledTimes(1);
        expect(call.mock.calls[0]?.[0]).toEqual([A, B]);
        expect(Object.keys(latest?.byId ?? {})).toEqual([String(A), String(B)]);
        expect(latest?.missingIds).toEqual([]);
        expect(queryClient.getQueryData(queryKeys.kitchenAdmin.ingredient(A))).toEqual(row(A));
        expect(queryClient.getQueryData(queryKeys.kitchenAdmin.ingredient(B))).toEqual(row(B));
    });

    it('names the ids the server answered without', async () => {
        await mount([A, B, C], async (ids) => ids.filter((id) => id !== B).map(row));

        await untilStatus('success');

        expect(latest?.missingIds).toEqual([B]);
        expect(latest?.byId[String(B)]).toBeUndefined();
    });

    it('exposes a failure instead of an empty record', async () => {
        await mount([A], async () => {
            throw new Error('Too many requests.');
        });

        await untilStatus('error');

        expect(latest?.error?.message).toBe('Too many requests.');
        expect(latest?.missingIds).toEqual([]);
    });

    it('answers an empty set at once, without a request', async () => {
        const { repositories } = await mount([], async () => []);

        expect(latest?.status).toBe('success');
        expect(latest?.byId).toEqual({});
        expect(repositories.kitchenAdmin.getIngredientsByIds).not.toHaveBeenCalled();
    });

    it('keys the same set the same way whatever its order', () => {
        expect(queryKeys.kitchenAdmin.ingredientsByIds([B, A, B])).toEqual(
            queryKeys.kitchenAdmin.ingredientsByIds([A, B]),
        );
    });
});
