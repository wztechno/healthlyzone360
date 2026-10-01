import { ApiError, apiFailure } from '@healthy360/api-client';
import type { PlacedOrder } from '@healthy360/api-client/contracts';
import { OrderId } from '@healthy360/domain-types';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { testMeResponse } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { currentStepIndex, stepPosition } from './order-progress.ts';
import { CustomerOrderScreen } from './screens/customer-order-screen.tsx';

/**
 * The signed-in order page, over the same tracking body the guest page draws.
 *
 * The guest page's own cases (the reference reminder, the conversion prompt, a cancelled order)
 * live in `../guest/guest.test.tsx`; this suite holds what is the account page's — its route
 * parameter is an identifier, its state vocabulary is the account wire's, and its way out is the
 * order history.
 */

jest.mock('expo-router', () => {
    const push = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace: jest.fn(), setParams: jest.fn(), back: jest.fn() }),
        usePathname: () => '/customer/orders/x',
        useLocalSearchParams: () => ({}),
        Redirect: () => null,
        Link: ({ children }: { children: ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __push: push,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __push: jest.Mock };

beforeEach(() => {
    routerMock.__push.mockClear();
});

const ORDER_ID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e8aa1';

function placedOrder(overrides: Partial<PlacedOrder> = {}): PlacedOrder {
    return {
        id: OrderId.unsafe(ORDER_ID),
        reference: 'H360-1042',
        state: 'confirmed',
        lines: [
            {
                id: 'line-1',
                name: 'Chicken Shawarma',
                quantity: 2,
                unitPrice: { amount: 3000, currency: 'AED' },
                lineTotal: { amount: 6000, currency: 'AED' },
            },
        ],
        priceLines: [
            { code: 'subtotal', label: 'Subtotal', amount: { amount: 6000, currency: 'AED' } },
        ],
        total: { amount: 6000, currency: 'AED' },
        address: {
            label: 'Home',
            line1: '12 Al Wasl Road',
            line2: null,
            area: 'Al Quoz',
            city: 'Dubai',
            countryCode: '',
            instructions: 'Blue gate, ring twice',
        },
        slotCode: '',
        deliveryDate: '',
        placedAt: '2026-08-03T09:10:00.000Z',
        ...overrides,
    };
}

describe('order progress', () => {
    it('places a cancelled order on no step, and finishes a delivered one', () => {
        expect(currentStepIndex('cancelled')).toBeNull();
        expect(currentStepIndex('confirmed')).toBe(1);
        // "Ready for pickup" is never a state of its own, so the drive is the fifth step.
        expect(currentStepIndex('out_for_delivery')).toBe(4);
        expect(currentStepIndex('delivered')).toBe(5);
        // The last step of a delivered order is done, not "in progress".
        expect(stepPosition(5, 5)).toBe('done');
        expect(stepPosition(4, 4)).toBe('current');
        expect(stepPosition(1, 1)).toBe('current');
        expect(stepPosition(2, 1)).toBe('upcoming');
        // Once the order is on the road, the step it skipped over is behind it.
        expect(stepPosition(3, 4)).toBe('done');
    });
});

describe('CustomerOrderScreen', () => {
    it('tracks the order by its identifier and says when no window was chosen', async () => {
        const { repositories } = await renderStubScreen(
            <CustomerOrderScreen orderId={ORDER_ID} />,
            {
                session: testMeResponse(),
                repositories: { commerce: { getMyOrder: async () => placedOrder() } },
            },
        );

        expect(await screen.findByTestId('customer-order-title')).toHaveTextContent(
            'Kitchen confirmed',
        );
        expect(repositories.commerce.getMyOrder).toHaveBeenCalledWith(ORDER_ID);
        expect(screen.getByTestId('customer-order-reference').props.children).toBe('H360-1042');
        expect(screen.getByTestId('customer-order-eyebrow')).toHaveTextContent(
            /^Order #H360-1042 · Placed /,
        );
        expect(
            screen.getByTestId('customer-order-timeline-confirmed').props.accessibilityLabel,
        ).toMatch(/, in progress$/);

        // No date and no slot on the order: the page says so rather than formatting an empty date.
        expect(screen.getByTestId('customer-order-slot')).toHaveTextContent('To be confirmed');
        expect(screen.getByTestId('customer-order-detail')).toHaveTextContent(
            /Blue gate, ring twice/,
        );

        // The first step carries what is owed and how, in the design's "payment · total" shape.
        expect(screen.getByTestId('customer-order-timeline-placed-detail')).toHaveTextContent(
            /^Cash on delivery · .*60/,
        );

        // The primary action asks the server again; the other two have no endpoint and say so.
        await fireEvent.press(screen.getByTestId('customer-order-refresh'));
        await waitFor(() => {
            expect(repositories.commerce.getMyOrder).toHaveBeenCalledTimes(2);
        });
        await fireEvent.press(screen.getByTestId('customer-order-message'));
        expect(await screen.findByTestId('prototype-notice')).toHaveTextContent(/Not built yet/);

        // A guest is told to keep the reference; an account holder has the history instead.
        expect(screen.queryByTestId('customer-order-reference-keep')).toBeNull();
        await fireEvent.press(screen.getByTestId('customer-order-history'));
        expect(routerMock.__push).toHaveBeenCalledWith('/customer/account?section=orders');
    });

    it('answers a malformed identifier as not found, without asking the server', async () => {
        const { repositories } = await renderStubScreen(
            <CustomerOrderScreen orderId="H360-1042" />,
            { session: testMeResponse() },
        );

        expect(await screen.findByTestId('customer-order-states-empty')).toBeTruthy();
        expect(repositories.commerce.getMyOrder).not.toHaveBeenCalled();
    });

    it('answers another account’s order the way it answers a missing one', async () => {
        await renderStubScreen(<CustomerOrderScreen orderId={ORDER_ID} />, {
            session: testMeResponse(),
            repositories: {
                commerce: {
                    getMyOrder: async () => {
                        throw new ApiError(apiFailure('resource.not_found'));
                    },
                },
            },
        });

        expect(await screen.findByTestId('customer-order-states-empty')).toHaveTextContent(
            /could not find that order/,
        );
    });
});
