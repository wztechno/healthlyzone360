import { createMemoryTokenStore } from '@healthy360/api-client';
import type { Repositories } from '@healthy360/api-client';
import type { DeliveryZoneAdmin } from '@healthy360/api-client/contracts';
import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AppProviders } from '../providers.tsx';
import { createStubRepositories, page } from '../testing/stub-repositories.ts';
import { TEST_METRICS } from '../testing/stub-screen.tsx';
import { useZoneSummaryQuery } from './kitchen-admin-hooks.ts';

/**
 * A hub figure costs one `limit: 1` request when the listing states its total, and falls back to
 * walking the cursor (from that first row, at 100 a page) when it does not.
 */

const zone = {} as DeliveryZoneAdmin;

function Probe() {
    const summary = useZoneSummaryQuery();
    return (
        <Text testID="probe">
            {summary.data === undefined
                ? 'pending'
                : `${String(summary.data.total)}/${String(summary.data.published)}/${String(summary.data.drafts)}`}
        </Text>
    );
}

async function mount(listZones: Repositories['kitchenAdmin']['listZones']) {
    const repositories = createStubRepositories({ kitchenAdmin: { listZones } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await render(
        <AppProviders
            initialMetrics={TEST_METRICS}
            repositories={repositories}
            tokenStore={createMemoryTokenStore(null)}
            queryClient={queryClient}
            initialOnline
        >
            <Probe />
        </AppProviders>,
    );
    return repositories.kitchenAdmin.listZones as jest.Mock;
}

describe('summary counts', () => {
    it('asks once per figure, for one row, when the listing states its total', async () => {
        const calls = await mount(async () => page([zone], { totalCount: 240 }));

        await waitFor(() => {
            expect(screen.getByTestId('probe')).toHaveTextContent('240/240/240');
        });
        expect(calls).toHaveBeenCalledTimes(3);
        for (const [filter] of calls.mock.calls) expect(filter).toMatchObject({ limit: 1 });
    });

    it('walks the cursor from the first row when the listing states no total', async () => {
        const calls = await mount(async (filter) =>
            filter?.cursor === undefined
                ? page([zone], { nextCursor: 'after-first', totalCount: null })
                : filter.cursor === 'after-first'
                  ? page([zone, zone], { nextCursor: 'after-third', totalCount: null })
                  : page([zone], { totalCount: null }),
        );

        await waitFor(() => {
            expect(screen.getByTestId('probe')).toHaveTextContent('4/4/4');
        });
        // Three figures, three requests each: the one-row probe, then two pages of 100.
        expect(calls).toHaveBeenCalledTimes(9);
        const walked = calls.mock.calls.map(([filter]) => [filter?.limit, filter?.cursor]);
        expect(walked.filter(([, cursor]) => cursor === undefined)).toEqual([
            [1, undefined],
            [1, undefined],
            [1, undefined],
        ]);
        expect(walked.filter(([, cursor]) => cursor !== undefined)).toEqual(
            expect.arrayContaining([
                [100, 'after-first'],
                [100, 'after-third'],
            ]),
        );
    });
});
