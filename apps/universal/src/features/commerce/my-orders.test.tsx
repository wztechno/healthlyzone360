import { ApiError, apiFailure } from '@healthy360/api-client/contracts';
import type { PlacedOrder } from '@healthy360/api-client/contracts';
import { OrderId } from '@healthy360/domain-types';
import type { IsoDateTime } from '@healthy360/domain-types';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { testMeResponse } from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { MyOrderDetailScreen, MyOrdersScreen } from './screens/my-orders-screen.tsx';

/** `/customer/orders` and `/customer/orders/{order}` over authored `GET /me/orders` answers. */

jest.mock('expo-router', () => {
    const push = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace: jest.fn(), back: jest.fn() }),
        usePathname: () => '/customer/orders',
        useLocalSearchParams: () => ({}),
        Redirect: () => null,
        Link: () => null,
        __push: push,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the mock's own handle.
const routerMock = require('expo-router') as { __push: jest.Mock };

beforeEach(() => {
    routerMock.__push.mockClear();
});

const FIRST = OrderId.unsafe('01935f6d-0000-7000-8000-00000000a001');
const SECOND = OrderId.unsafe('01935f6d-0000-7000-8000-00000000a002');

function order(id: OrderId, overrides: Partial<PlacedOrder> = {}): PlacedOrder {
    return {
        id,
        reference: `HZ-${String(id).slice(-4)}`,
        state: 'placed',
        lines: [
            {
                id: `${String(id)}-l1`,
                name: 'Chicken Shawarma Bowl',
                quantity: 2,
                unitPrice: { amount: 4500, currency: 'AED' },
                lineTotal: { amount: 9000, currency: 'AED' },
            },
        ],
        priceLines: [
            { code: 'subtotal', label: 'Subtotal', amount: { amount: 9000, currency: 'AED' } },
            { code: 'delivery', label: 'Delivery', amount: { amount: 1000, currency: 'AED' } },
        ],
        total: { amount: 10000, currency: 'AED' },
        address: {
            label: 'Home',
            line1: '12 Marina Walk',
            line2: null,
            area: 'Dubai Marina',
            city: 'Dubai',
            countryCode: '',
            instructions: null,
        },
        slotCode: 'midday',
        deliveryDate: '2026-10-08',
        placedAt: '2026-10-07T09:30:00Z' as IsoDateTime,
        ...overrides,
    };
}

describe('MyOrdersScreen', () => {
    it('lists each order with its reference, status and total, and opens one', async () => {
        await renderStubScreen(<MyOrdersScreen />, {
            session: testMeResponse(),
            repositories: {
                commerce: {
                    listMyOrders: async () =>
                        page([order(FIRST, { state: 'delivered' }), order(SECOND)]),
                },
            },
        });

        expect(await screen.findByTestId('my-orders-list')).toBeTruthy();
        expect(screen.getByText('HZ-a001')).toBeTruthy();
        expect(screen.getByText('HZ-a002')).toBeTruthy();
        expect(screen.getByTestId(`my-order-row-${String(FIRST)}-state`)).toHaveTextContent(
            'Delivered',
        );
        expect(screen.getByTestId(`my-order-row-${String(SECOND)}-state`)).toHaveTextContent(
            'Placed',
        );
        expect(screen.queryByTestId('my-orders-more')).toBeNull();

        await fireEvent.press(screen.getByTestId(`my-order-row-${String(SECOND)}`));
        expect(routerMock.__push).toHaveBeenCalledWith(`/customer/orders/${String(SECOND)}`);
    });

    it('says so when there are no orders, and offers the catalogue', async () => {
        await renderStubScreen(<MyOrdersScreen />, {
            session: testMeResponse(),
            repositories: { commerce: { listMyOrders: async () => page([]) } },
        });

        expect(await screen.findByTestId('my-orders-empty')).toBeTruthy();
        await fireEvent.press(screen.getByTestId('my-orders-browse'));
        expect(routerMock.__push).toHaveBeenCalledWith('/meals');
    });

    it('offers older orders when the server says there are more', async () => {
        const harness = await renderStubScreen(<MyOrdersScreen />, {
            session: testMeResponse(),
            repositories: {
                commerce: {
                    listMyOrders: async (request) =>
                        request?.cursor === 'next'
                            ? page([order(SECOND)])
                            : page([order(FIRST)], { nextCursor: 'next' }),
                },
            },
        });

        await fireEvent.press(await screen.findByTestId('my-orders-more'));
        expect(await screen.findByText('HZ-a002')).toBeTruthy();
        expect(harness.repositories.commerce.listMyOrders).toHaveBeenLastCalledWith({
            cursor: 'next',
        });
    });
});

describe('MyOrderDetailScreen', () => {
    it('shows the status, the lines, the total and the delivery snapshot', async () => {
        await renderStubScreen(<MyOrderDetailScreen orderId={String(FIRST)} />, {
            session: testMeResponse(),
            repositories: {
                commerce: { getMyOrder: async () => order(FIRST, { state: 'confirmed' }) },
            },
        });

        expect(await screen.findByTestId('my-order-header-title')).toHaveTextContent('HZ-a001');
        expect(screen.getByTestId('my-order-state')).toHaveTextContent('Confirmed by the kitchen');
        expect(screen.getByText('2 × Chicken Shawarma Bowl')).toBeTruthy();
        expect(screen.getByTestId('my-order-price-total-amount')).toHaveTextContent(/100/);
        expect(screen.getByTestId('my-order-address')).toHaveTextContent(
            '12 Marina Walk, Dubai Marina, Dubai',
        );
        expect(screen.getByTestId('my-order-slot')).toBeTruthy();
    });

    it('renders not-found for an order that is not the caller’s', async () => {
        await renderStubScreen(<MyOrderDetailScreen orderId={String(SECOND)} />, {
            session: testMeResponse(),
            repositories: {
                commerce: {
                    getMyOrder: async () => {
                        throw new ApiError(apiFailure('resource.not_found'));
                    },
                },
            },
        });

        expect(await screen.findByTestId('my-order-empty')).toBeTruthy();
    });

    it('renders not-found without asking when the identifier is malformed', async () => {
        const harness = await renderStubScreen(<MyOrderDetailScreen orderId="nope" />, {
            session: testMeResponse(),
        });

        await waitFor(() => {
            expect(screen.getByTestId('my-order-empty')).toBeTruthy();
        });
        expect(harness.repositories.commerce.getMyOrder).not.toHaveBeenCalled();
    });
});
