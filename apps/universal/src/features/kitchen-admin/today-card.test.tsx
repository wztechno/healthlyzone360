import type { OrderDeskToday } from '@healthy360/api-client/contracts';
import type { CurrencyCode } from '@healthy360/domain-types';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { View } from 'react-native';

import { Can } from '../../access/gate.tsx';
import {
    TEST_BRANCH_ID,
    kitchenManagerSession,
    testActiveContext,
} from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { TodayCard } from './today-card.tsx';

/* `mock`-prefixed so the factory below may close over it — Jest's hoisting rule. */
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kitchen',
    useLocalSearchParams: () => ({}),
    useGlobalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

const TODAY: OrderDeskToday = {
    day: '2026-05-10',
    timezone: 'Asia/Beirut',
    sales: [
        { currencyCode: 'LBP' as CurrencyCode, amountMinor: 900_000 },
        { currencyCode: 'USD' as CurrencyCode, amountMinor: 5_000 },
    ],
    orders: 4,
    cashExpected: [{ currencyCode: 'USD' as CurrencyCode, amountMinor: 3_500 }],
    cashCounted: [{ currencyCode: 'USD' as CurrencyCode, amountMinor: 1_200 }],
    overdue: 2,
    pastDue: 3,
    cancelled: { returned: 1, wasted: 2, other: 0 },
};

beforeEach(() => {
    mockPush.mockClear();
});

describe('the kitchen home Today card', () => {
    it('shows the day per currency and opens the desk on its past-due lens', async () => {
        const getToday = jest.fn(async () => TODAY);
        await renderStubScreen(<TodayCard branchId={TEST_BRANCH_ID} />, {
            session: kitchenManagerSession(),
            repositories: { orderDesk: { getToday } },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-home-today-figures-late-value')).toHaveTextContent(
                '2',
            );
        });
        expect(getToday).toHaveBeenCalledWith(TEST_BRANCH_ID);
        // Two currencies, side by side, never one sum.
        expect(screen.getByTestId('kitchen-home-today-figures-sales-value')).toHaveTextContent(
            /\$50\.00/,
        );
        expect(screen.getByTestId('kitchen-home-today-figures-sales-value')).toHaveTextContent(/·/);
        expect(screen.getByText('Orders: 4')).toBeTruthy();
        expect(screen.getByText(/Last till count today: \$12\.00/)).toBeTruthy();
        expect(screen.getByText('Past due: 3')).toBeTruthy();
        expect(screen.getByTestId('kitchen-home-today-figures-cancelled-value')).toHaveTextContent(
            '3',
        );
        expect(screen.getByText('Returned 1 · wasted 2 · other 0')).toBeTruthy();

        fireEvent.press(screen.getByTestId('kitchen-home-today-figures-late'));
        expect(mockPush).toHaveBeenCalledWith('/kitchen/order-desk?lens=past_due');
    });

    it('opens the Cash page on its Daily close tab from Cash to collect', async () => {
        await renderStubScreen(<TodayCard branchId={TEST_BRANCH_ID} />, {
            session: kitchenManagerSession(),
            repositories: { orderDesk: { getToday: async () => TODAY } },
        });

        fireEvent.press(await screen.findByTestId('kitchen-home-today-figures-cash'));
        expect(mockPush).toHaveBeenCalledWith('/kitchen/order-desk/cash?tab=close');
    });

    it('leaves Cash to collect as a figure for a manager who may not count the till', async () => {
        const context = testActiveContext();
        await renderStubScreen(<TodayCard branchId={TEST_BRANCH_ID} />, {
            session: kitchenManagerSession({
                activeContext: {
                    ...context,
                    permissions: context.permissions.filter(
                        (code) => code !== 'order.settle_cash_organisation',
                    ),
                },
            }),
            repositories: { orderDesk: { getToday: async () => TODAY } },
        });

        fireEvent.press(await screen.findByTestId('kitchen-home-today-figures-cash'));
        expect(mockPush).not.toHaveBeenCalledWith('/kitchen/order-desk/cash?tab=close');
    });

    it('stays hidden, and asks for nothing, without order.manage_organisation', async () => {
        const getToday = jest.fn(async () => TODAY);
        const context = testActiveContext();
        await renderStubScreen(
            <>
                {/* Appears once the session has loaded, so the absence below is not just early. */}
                <Can permission="order.view_organisation">
                    <View testID="session-ready" />
                </Can>
                <TodayCard branchId={TEST_BRANCH_ID} />
            </>,
            {
                session: kitchenManagerSession({
                    activeContext: {
                        ...context,
                        permissions: context.permissions.filter(
                            (code) => code !== 'order.manage_organisation',
                        ),
                    },
                }),
                repositories: { orderDesk: { getToday } },
            },
        );

        await waitFor(() => {
            expect(screen.getByTestId('session-ready')).toBeTruthy();
        });
        expect(screen.queryByTestId('kitchen-home-today')).toBeNull();
        expect(getToday).not.toHaveBeenCalled();
    });
});
