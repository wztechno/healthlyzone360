import { apiFailure } from '@healthy360/api-client/contracts';
import type { ConsumptionException, CursorPage } from '@healthy360/api-client/contracts';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Dimensions } from 'react-native';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { ConsumptionExceptionsScreen } from './screens/consumption-exceptions-screen.tsx';
import { withReturnTo } from '../../navigation/return-to.ts';

/** An ingredient id, as a gap reads it out of its detail line. */
const LENTILS_ID = '0f9a6c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b';

const mockRouter = {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    setParams: jest.fn(),
    dismissTo: jest.fn(),
    canGoBack: jest.fn(() => true),
};

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => mockRouter,
    usePathname: () => '/kitchen/consumption-exceptions',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

beforeEach(() => {
    jest.clearAllMocks();
});

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
        itemType: null,
        recipeId: null,
        ingredientId: null,
        ingredientNameEn: null,
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

    /*
     * Stock gaps → Fix in recipe → back. A gap a recipe change closes leads to that recipe, and the
     * list keeps its place in the URL so coming back lands on the same gap.
     */
    describe('fix in recipe', () => {
        const LENTILS = '0f9a6c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b';
        const fixableGap = (overrides: Partial<ConsumptionException> = {}) =>
            exception({
                itemNameEn: 'Lentil Soup',
                catalogueItemId: 'item-1',
                itemType: 'meal',
                recipeId: 'recipe-1',
                reasonCode: 'unquantified_recipe_line',
                ingredientId: LENTILS,
                ingredientNameEn: 'Red lentils',
                detail: `A recipe line for ingredient ${LENTILS} has no quantity or unit.`,
                ...overrides,
            });

        it('leads a fixable row with Fix in recipe, carrying this exact view as the way back', async () => {
            await renderStubScreen(<ConsumptionExceptionsScreen page="2" />, {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenOps: {
                        listConsumptionExceptions: async () => ({
                            items: [fixableGap()],
                            nextCursor: null,
                            hasMore: false,
                            totalCount: 30,
                        }),
                    },
                },
            });

            await untilVisible('kitchen-exception-exception-1-fix');
            expect(screen.getByTestId('kitchen-exception-exception-1-fix')).toHaveTextContent(
                'Fix in recipe',
            );
            // The ingredient the gap is about, beside the item.
            expect(screen.getByTestId('kitchen-exception-exception-1-item')).toHaveTextContent(
                'Lentil Soup · Red lentils',
            );

            await act(async () => {
                fireEvent.press(screen.getByTestId('kitchen-exception-exception-1-fix'));
            });

            expect(mockRouter.push).toHaveBeenCalledTimes(1);
            const href = String(mockRouter.push.mock.calls[0]?.[0]);
            const url = new URL(href, 'https://kitchen.test');
            expect(url.pathname).toBe('/kitchen/recipes/recipe-1');
            expect(url.searchParams.get('fix')).toBe('unquantified_recipe_line');
            expect(url.searchParams.get('ingredient')).toBe(LENTILS);
            // `returnTo` is encoded twice; the router's two decodes give back the view: page 2,
            // this gap open.
            expect(decodeURIComponent(url.searchParams.get('returnTo') ?? '')).toBe(
                '/kitchen/consumption-exceptions?page=2&gap=exception-1',
            );
        });

        it('says a product sold as its own ingredient once, not twice', async () => {
            await renderStubScreen(<ConsumptionExceptionsScreen />, {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenOps: {
                        listConsumptionExceptions: async () =>
                            pageOf([
                                exception({
                                    itemNameEn: 'Barbecue Dip',
                                    ingredientNameEn: 'barbecue dip',
                                }),
                            ]),
                    },
                },
            });

            await untilVisible('kitchen-exception-exception-1-item');
            expect(screen.getByTestId('kitchen-exception-exception-1-item')).toHaveTextContent(
                /^Barbecue Dip$/,
            );
        });

        it('offers no fix for a gap nothing can fix — an order with no branch', async () => {
            await renderStubScreen(<ConsumptionExceptionsScreen />, {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenOps: {
                        listConsumptionExceptions: async () =>
                            pageOf([exception({ reasonCode: 'no_branch' })]),
                    },
                },
            });

            await untilVisible('kitchen-exception-exception-1-retry');
            expect(screen.queryByTestId('kitchen-exception-exception-1-fix')).toBeNull();
        });

        it('leads a shortage with Add stock, opening that shelf with the way back', async () => {
            await renderStubScreen(<ConsumptionExceptionsScreen />, {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenOps: {
                        listConsumptionExceptions: async () =>
                            pageOf([exception({ ingredientId: LENTILS_ID })]),
                    },
                },
            });

            await untilVisible('kitchen-exception-exception-1-fix');
            expect(screen.getByTestId('kitchen-exception-exception-1-fix')).toHaveTextContent(
                'Add stock',
            );
            await act(async () => {
                fireEvent.press(screen.getByTestId('kitchen-exception-exception-1-fix'));
            });
            expect(mockRouter.push).toHaveBeenCalledWith(
                withReturnTo(
                    `/kitchen/stock?ingredient=${LENTILS_ID}`,
                    '/kitchen/consumption-exceptions?gap=exception-1',
                ),
            );
        });

        it('leads a gap with no cost to the ingredient’s unit price', async () => {
            await renderStubScreen(<ConsumptionExceptionsScreen />, {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenOps: {
                        listConsumptionExceptions: async () =>
                            pageOf([
                                exception({
                                    reasonCode: 'no_ingredient_cost',
                                    ingredientId: LENTILS_ID,
                                }),
                            ]),
                    },
                },
            });

            await untilVisible('kitchen-exception-exception-1-fix');
            expect(screen.getByTestId('kitchen-exception-exception-1-fix')).toHaveTextContent(
                'Set unit price',
            );
            await act(async () => {
                fireEvent.press(screen.getByTestId('kitchen-exception-exception-1-fix'));
            });
            expect(mockRouter.push).toHaveBeenCalledWith(
                withReturnTo(
                    `/kitchen/ingredients/${LENTILS_ID}?needs=price`,
                    '/kitchen/consumption-exceptions?gap=exception-1',
                ),
            );
        });

        it('calls an open gap Unresolved, and narrows the page by search', async () => {
            await renderStubScreen(<ConsumptionExceptionsScreen />, {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenOps: {
                        listConsumptionExceptions: async () =>
                            pageOf([
                                exception(),
                                exception({ id: 'exception-2', orderNumber: '0151' }),
                            ]),
                    },
                },
            });

            await untilVisible('kitchen-exception-exception-1-open');
            expect(screen.getByTestId('kitchen-exception-exception-1-open')).toHaveTextContent(
                'Unresolved',
            );

            await act(async () => {
                fireEvent.changeText(
                    screen.getByTestId('kitchen-consumption-exceptions-toolbar-search-input'),
                    '0151',
                );
            });
            await waitFor(() => {
                expect(screen.queryByTestId('kitchen-exception-exception-1-order')).toBeNull();
            });
            expect(screen.getByTestId('kitchen-exception-exception-2-order')).toBeTruthy();
        });

        it('reopens the gap the URL names, with Fix in recipe first and Retry under it', async () => {
            await renderStubScreen(<ConsumptionExceptionsScreen gap="exception-1" />, {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenOps: {
                        listConsumptionExceptions: async () => pageOf([fixableGap()]),
                    },
                },
            });

            await untilVisible('kitchen-consumption-exceptions-window');
            expect(screen.getByTestId('kitchen-consumption-exceptions-window-fix')).toBeTruthy();
            expect(screen.getByTestId('kitchen-consumption-exceptions-window-retry')).toBeTruthy();
            expect(
                screen.queryByTestId('kitchen-consumption-exceptions-window-primary'),
            ).toBeNull();
            // The ingredient by name; the raw detail with its id in it is not shown.
            expect(
                screen.getByTestId('kitchen-consumption-exceptions-window-field-ingredient'),
            ).toHaveTextContent(/Red lentils/);
            expect(
                screen.queryByTestId('kitchen-consumption-exceptions-window-field-detail'),
            ).toBeNull();
            // No always-on explanation above the record.
            expect(screen.queryByTestId('kitchen-consumption-exceptions-window-note')).toBeNull();

            await act(async () => {
                fireEvent.press(screen.getByTestId('kitchen-consumption-exceptions-window-fix'));
            });
            const href = String(mockRouter.push.mock.calls[0]?.[0]);
            expect(href.startsWith('/kitchen/recipes/recipe-1?')).toBe(true);
        });

        it('makes Retry the next step once the recipe comes back fixed', async () => {
            const harness = await renderStubScreen(
                <ConsumptionExceptionsScreen gap="exception-1" fixed="1" />,
                {
                    session: kitchenManagerSession(),
                    repositories: {
                        kitchenOps: {
                            listConsumptionExceptions: async () => pageOf([fixableGap()]),
                            retryConsumptionException: async () => fixableGap({ resolved: true }),
                        },
                    },
                },
            );

            await untilVisible('kitchen-consumption-exceptions-window-primary');
            expect(
                screen.getByTestId('kitchen-consumption-exceptions-window-primary'),
            ).toHaveTextContent(/Retry the deduction$/);
            expect(screen.queryByTestId('kitchen-consumption-exceptions-window-fix')).toBeNull();

            await act(async () => {
                fireEvent.press(
                    screen.getByTestId('kitchen-consumption-exceptions-window-primary'),
                );
            });

            await untilVisible('kitchen-exception-retried-toast');
            expect(harness.repositories.kitchenOps.retryConsumptionException).toHaveBeenCalledWith(
                'exception-1',
            );
            // Retried: the record closes, and the address stops naming it.
            expect(mockRouter.setParams).toHaveBeenLastCalledWith(
                expect.objectContaining({ gap: undefined, fixed: undefined }),
            );
        });

        it('asks for the raised-between window the URL holds, both ends inclusive', async () => {
            const harness = await renderStubScreen(
                <ConsumptionExceptionsScreen from="2026-08-01" to="2026-08-31" />,
                {
                    session: kitchenManagerSession(),
                    repositories: {
                        kitchenOps: {
                            listConsumptionExceptions: async () => pageOf([exception()]),
                        },
                    },
                },
            );

            await untilVisible('kitchen-consumption-exceptions-table');
            expect(harness.repositories.kitchenOps.listConsumptionExceptions).toHaveBeenCalledWith(
                expect.objectContaining({ from: '2026-08-01', to: '2026-08-31' }),
            );
            expect(screen.getByTestId('kitchen-exceptions-filter-from-trigger')).toBeTruthy();
            expect(screen.getByTestId('kitchen-exceptions-filter-to-trigger')).toBeTruthy();
        });

        it('starts from the view the URL holds and writes every change back to it', async () => {
            const harness = await renderStubScreen(
                <ConsumptionExceptionsScreen status="resolved" page="2" />,
                {
                    session: kitchenManagerSession(),
                    repositories: {
                        kitchenOps: {
                            listConsumptionExceptions: async () => ({
                                items: [fixableGap()],
                                nextCursor: null,
                                hasMore: false,
                                totalCount: 30,
                            }),
                        },
                    },
                },
            );
            const list = harness.repositories.kitchenOps.listConsumptionExceptions;

            await untilVisible('kitchen-consumption-exceptions-table');
            expect(list).toHaveBeenCalledWith(expect.objectContaining({ resolved: true, page: 2 }));
            // Seeding is not a change: nothing is written back on arrival.
            expect(mockRouter.setParams).not.toHaveBeenCalled();

            await act(async () => {
                fireEvent.press(
                    screen.getByTestId('kitchen-consumption-exceptions-toolbar-status-unresolved'),
                );
            });
            // Back to the default status, and to page 1 with it: both leave the address.
            expect(mockRouter.setParams).toHaveBeenLastCalledWith(
                expect.objectContaining({ status: undefined, page: undefined, gap: undefined }),
            );
        });
    });
});
