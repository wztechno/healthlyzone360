import type { ConsumptionException, CursorPage } from '@healthy360/api-client/contracts';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Dimensions } from 'react-native';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { ConsumptionExceptionsScreen } from './screens/consumption-exceptions-screen.tsx';

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kitchen/consumption-exceptions',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * The consumption-exceptions queue's Status header.
 *
 * The list is cursor-paged, so the header cannot narrow the page in hand: it has to travel with the
 * request as `resolved`, the same parameter the toolbar's segmented control already sends.
 */

function exception(overrides: Partial<ConsumptionException> = {}): ConsumptionException {
    return {
        id: 'exception-1',
        orderId: null,
        orderNumber: '0148',
        orderLineId: null,
        catalogueItemId: null,
        itemNameEn: 'Grilled chicken bowl',
        branchId: null,
        branchName: 'Beirut Central',
        reasonCode: 'insufficient_stock',
        detail: null,
        resolved: false,
        resolvedAt: null,
        resolvedBy: null,
        resolutionNote: null,
        createdAt: '2026-08-28T09:00:00.000Z',
        ...overrides,
    };
}

function pageOf(items: readonly ConsumptionException[]): CursorPage<ConsumptionException> {
    return { items, nextCursor: null, hasMore: false, totalCount: null };
}

function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 10_000 },
    );
}

describe('consumption exceptions at desk width', () => {
    // The column headers are only drawn above `md`; below it the list is a stack of cards.
    const narrowWindow = Dimensions.get('window');
    const narrowScreen = Dimensions.get('screen');
    beforeAll(() => {
        Dimensions.set({
            window: { ...narrowWindow, width: 1440, height: 900 },
            screen: { ...narrowScreen, width: 1440, height: 900 },
        });
    });
    afterAll(() => {
        Dimensions.set({ window: narrowWindow, screen: narrowScreen });
    });

    it('sends the Status header’s choice with the request, and clears it back to all', async () => {
        const harness = await renderStubScreen(<ConsumptionExceptionsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    listConsumptionExceptions: async (filter) =>
                        pageOf([exception({ resolved: filter?.resolved === true })]),
                },
            },
        });
        const list = harness.repositories.kitchenOps.listConsumptionExceptions;

        await untilVisible('kitchen-consumption-exceptions-table-column-status-trigger');
        // The queue opens on every status, from today: no `resolved` at all, and a `from`.
        expect(list).toHaveBeenLastCalledWith(
            expect.not.objectContaining({ resolved: expect.anything() }),
        );
        expect(list).toHaveBeenLastCalledWith(
            expect.objectContaining({ from: expect.any(String) }),
        );

        await act(async () => {
            fireEvent.press(
                screen.getByTestId('kitchen-consumption-exceptions-table-column-status-trigger'),
            );
        });
        await untilVisible('kitchen-consumption-exceptions-table-column-status-resolved');
        await act(async () => {
            fireEvent.press(
                screen.getByTestId('kitchen-consumption-exceptions-table-column-status-resolved'),
            );
        });

        await waitFor(() => {
            expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ resolved: true }));
        });
        await untilVisible('kitchen-exception-exception-1-resolved');

        await act(async () => {
            fireEvent.press(
                screen.getByTestId('kitchen-consumption-exceptions-table-column-status-trigger'),
            );
        });
        await untilVisible('kitchen-consumption-exceptions-table-column-status-clear');
        await act(async () => {
            fireEvent.press(
                screen.getByTestId('kitchen-consumption-exceptions-table-column-status-clear'),
            );
        });

        // Clear is "all": no `resolved` at all, not `resolved: false`.
        await waitFor(() => {
            const calls = jest.mocked(list).mock.calls;
            expect(calls[calls.length - 1]?.[0]).not.toHaveProperty('resolved');
        });
    });
});
