import { apiFailure } from '@healthy360/api-client/contracts';
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
        // The queue opens on every unresolved gap, whenever it opened — the count the sidebar
        // links here with — so `resolved: false` and no `from`.
        expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ resolved: false }));
        expect(list).toHaveBeenLastCalledWith(
            expect.not.objectContaining({ from: expect.anything() }),
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
    it('shows whole totals on its cards and pages with the shared numbered pager', async () => {
        // 84 open gaps across five pages of 18 — the case that read "25" before.
        const harness = await renderStubScreen(<ConsumptionExceptionsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    listConsumptionExceptions: async () => ({
                        items: Array.from({ length: 18 }, (_, index) =>
                            exception({ id: `exception-${String(index + 1)}` }),
                        ),
                        nextCursor: null,
                        hasMore: true,
                        totalCount: 84,
                    }),
                    countConsumptionExceptions: async () => ({ unresolved: 84, resolved: 3 }),
                },
            },
        });
        const list = harness.repositories.kitchenOps.listConsumptionExceptions;

        await untilVisible('kitchen-consumption-exceptions-pagination');
        expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, perPage: 18 }));
        await waitFor(() => {
            expect(
                screen.getByTestId('kitchen-consumption-exceptions-summary-unresolved'),
            ).toHaveTextContent(/84/);
        });
        expect(
            screen.getByTestId('kitchen-consumption-exceptions-summary-resolved'),
        ).toHaveTextContent(/3/);
        expect(
            screen.getByTestId('kitchen-consumption-exceptions-summary-shown'),
        ).toHaveTextContent(/18.*84/);
        // One pager: the old cursor buttons are gone.
        expect(screen.queryByTestId('kitchen-consumption-exceptions-next')).toBeNull();
    });

    /*
     * Retry used to say nothing either way: a 500 left the row as it was, and so did a retry that
     * ran but still could not deduct. Each now says which it was.
     */
    it('says when a retry still could not deduct, and when it failed outright', async () => {
        let attempt = 0;
        await renderStubScreen(<ConsumptionExceptionsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    listConsumptionExceptions: async () => pageOf([exception()]),
                    retryConsumptionException: async () => {
                        attempt += 1;
                        if (attempt === 1) return exception();
                        throw apiFailure('server', { message: 'The server could not run it.' });
                    },
                },
            },
        });

        await untilVisible('kitchen-exception-exception-1-retry');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-exception-exception-1-retry'));
        });
        await untilVisible('kitchen-exception-retried-toast');
        expect(screen.getByTestId('kitchen-exception-retried-toast')).toHaveTextContent(
            /0148 still could not be deducted/,
        );

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-exception-exception-1-retry'));
        });
        await untilVisible('kitchen-exception-action-failed-toast');
        expect(screen.getByTestId('kitchen-exception-action-failed-toast')).toHaveTextContent(
            /The server could not run it\./,
        );
    });
});
