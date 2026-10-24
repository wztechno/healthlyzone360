import { ApiError, apiFailure } from '@healthy360/api-client';
import type { PlacedOrder } from '@healthy360/api-client/contracts';
import { OrderId } from '@healthy360/domain-types';
import { focusManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { ExpoRouterMock } from '../../testing/expo-router-mock.ts';
import { testMeResponse } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { currentStepIndex, stepPosition } from './order-progress.ts';
import {
    CustomerOrderScreen,
    ORDER_HISTORY_HREF,
    ORDER_TRACKING_POLL_MS,
} from './screens/customer-order-screen.tsx';

/**
 * The signed-in order page, over the same tracking body the guest page draws.
 *
 * The guest page's own cases (the reference reminder, the conversion prompt, a cancelled order)
 * live in `../guest/guest.test.tsx`; this suite holds what is the account page's — its route
 * parameter is an identifier, its state vocabulary is the account wire's, and its way out is the
 * order history.
 */

jest.mock('expo-router', () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../testing/expo-router-mock.ts').createExpoRouterMock({
        pathname: '/customer/orders/x',
    }),
);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as ExpoRouterMock;

beforeEach(() => {
    routerMock.__reset();
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
        // The kitchen's Ready and the driver's Picked up are steps of their own (HA-19).
        expect(currentStepIndex('ready_for_pickup')).toBe(3);
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

        // The page keeps itself current, so there is no Refresh to press; "Get help" has no
        // endpoint and says so.
        expect(screen.queryByTestId('customer-order-refresh')).toBeNull();
        // Nobody is driving it yet, so there is no courier to message.
        expect(screen.queryByTestId('customer-order-message')).toBeNull();
        await fireEvent.press(screen.getByTestId('customer-order-help'));
        expect(await screen.findByTestId('prototype-notice')).toHaveTextContent(/Not built yet/);

        // A guest is told to keep the reference; an account holder has the history instead —
        // at the top of the page, under its own name, with the order as the current crumb.
        expect(screen.queryByTestId('customer-order-reference-keep')).toBeNull();
        expect(screen.getByTestId('customer-order-trail-up')).toHaveTextContent('Order history');
        expect(screen.getByTestId('customer-order-trail')).toHaveTextContent(/H360-1042/);
        await fireEvent.press(screen.getByTestId('customer-order-trail-up'));
        // Up to the history by name: popped to when it is underneath, never pushed on top.
        expect(routerMock.__router.dismissTo).toHaveBeenCalledWith(ORDER_HISTORY_HREF);
        expect(ORDER_HISTORY_HREF).toBe('/customer/account?section=orders');
        expect(routerMock.__push).not.toHaveBeenCalled();
    });

    it('walks the steps with the time each was reached, and offers the courier only on the road (HA-19)', async () => {
        await renderStubScreen(<CustomerOrderScreen orderId={ORDER_ID} />, {
            session: testMeResponse(),
            repositories: {
                commerce: {
                    getMyOrder: async () =>
                        placedOrder({
                            state: 'out_for_delivery',
                            stepTimes: {
                                confirmed: '2026-08-03T09:12:00.000Z',
                                preparing: null,
                                ready_for_pickup: '2026-08-03T09:40:00.000Z',
                                out_for_delivery: '2026-08-03T09:45:00.000Z',
                                delivered: null,
                            },
                        }),
                },
            },
        });

        expect(await screen.findByTestId('customer-order-title')).toHaveTextContent(
            'Out for delivery',
        );
        expect(
            screen.getByTestId('customer-order-timeline-ready_for_pickup').props.accessibilityLabel,
        ).toMatch(/, done$/);
        expect(
            screen.getByTestId('customer-order-timeline-out_for_delivery').props.accessibilityLabel,
        ).toMatch(/, in progress$/);
        expect(screen.getByTestId('customer-order-timeline-confirmed-time')).toBeTruthy();
        expect(screen.getByTestId('customer-order-timeline-out_for_delivery-time')).toBeTruthy();
        // Nothing stamps cooking, and the door has not been reached: no time is invented for either.
        expect(screen.queryByTestId('customer-order-timeline-preparing-time')).toBeNull();
        expect(screen.queryByTestId('customer-order-timeline-delivered-time')).toBeNull();
        expect(screen.getByTestId('customer-order-message')).toBeTruthy();
    });

    it('says when it was delivered instead of when it is arriving', async () => {
        await renderStubScreen(<CustomerOrderScreen orderId={ORDER_ID} />, {
            session: testMeResponse(),
            repositories: {
                commerce: {
                    getMyOrder: async () =>
                        placedOrder({
                            state: 'delivered',
                            deliveryDate: '2026-08-03',
                            stepTimes: {
                                confirmed: '2026-08-03T09:12:00.000Z',
                                preparing: null,
                                ready_for_pickup: '2026-08-03T09:40:00.000Z',
                                out_for_delivery: '2026-08-03T09:45:00.000Z',
                                delivered: '2026-08-03T10:05:00.000Z',
                            },
                        }),
                },
            },
        });

        expect(await screen.findByTestId('customer-order-window')).toHaveTextContent(/^Delivered/);
        expect(screen.getByTestId('customer-order-timeline-delivered-time')).toBeTruthy();
        expect(screen.queryByTestId('customer-order-message')).toBeNull();
    });

    it('keeps itself current while the order is moving, and stops once it is delivered (HA-23)', async () => {
        // Time still flows, so the screen settles as usual; the jump below is the interval only.
        jest.useFakeTimers({ advanceTimers: true });
        try {
            let state: PlacedOrder['state'] = 'placed';
            const { repositories } = await renderStubScreen(
                <CustomerOrderScreen orderId={ORDER_ID} />,
                {
                    session: testMeResponse(),
                    repositories: { commerce: { getMyOrder: async () => placedOrder({ state }) } },
                },
            );
            expect(await screen.findByTestId('customer-order-title')).toHaveTextContent(
                'Order placed',
            );
            const reads = (repositories.commerce.getMyOrder as jest.Mock).mock.calls.length;

            // The kitchen confirms; nobody presses Refresh.
            state = 'confirmed';
            await jest.advanceTimersByTimeAsync(ORDER_TRACKING_POLL_MS);
            await waitFor(() => {
                expect(screen.getByTestId('customer-order-title')).toHaveTextContent(
                    'Kitchen confirmed',
                );
            });

            state = 'delivered';
            await jest.advanceTimersByTimeAsync(ORDER_TRACKING_POLL_MS);
            await waitFor(() => {
                expect(screen.getByTestId('customer-order-title')).toHaveTextContent('Delivered');
            });
            const delivered = (repositories.commerce.getMyOrder as jest.Mock).mock.calls.length;
            expect(delivered).toBeGreaterThan(reads);

            // Nothing more can happen to a delivered order, so the page stops asking.
            await jest.advanceTimersByTimeAsync(ORDER_TRACKING_POLL_MS * 3);
            expect(repositories.commerce.getMyOrder).toHaveBeenCalledTimes(delivered);
        } finally {
            jest.useRealTimers();
        }
    });

    it('waits while the tab is hidden, and catches up the moment it is shown again', async () => {
        jest.useFakeTimers({ advanceTimers: true });
        try {
            let state: PlacedOrder['state'] = 'confirmed';
            const { repositories, view } = await renderStubScreen(
                <CustomerOrderScreen orderId={ORDER_ID} />,
                {
                    session: testMeResponse(),
                    repositories: { commerce: { getMyOrder: async () => placedOrder({ state }) } },
                },
            );
            expect(await screen.findByTestId('customer-order-title')).toHaveTextContent(
                'Kitchen confirmed',
            );

            // The customer switches to another window; the kitchen starts cooking meanwhile.
            await act(() => {
                focusManager.setFocused(false);
            });
            const reads = (repositories.commerce.getMyOrder as jest.Mock).mock.calls.length;
            state = 'preparing';
            await jest.advanceTimersByTimeAsync(ORDER_TRACKING_POLL_MS * 2);
            expect(repositories.commerce.getMyOrder).toHaveBeenCalledTimes(reads);

            // Back on the tab: read at once, not at the next tick.
            await act(() => {
                focusManager.setFocused(true);
            });
            await waitFor(() => {
                expect(screen.getByTestId('customer-order-title')).toHaveTextContent('Cooking now');
            });
            expect(repositories.commerce.getMyOrder).toHaveBeenCalledTimes(reads + 1);
            // Still moving, so still polling: stop it here, under the fake clock that drives it.
            view.unmount();
        } finally {
            focusManager.setFocused(undefined);
            jest.useRealTimers();
        }
    });

    it('answers a malformed identifier as not found, without asking the server', async () => {
        const { repositories } = await renderStubScreen(
            <CustomerOrderScreen orderId="H360-1042" />,
            { session: testMeResponse() },
        );

        expect(await screen.findByTestId('customer-order-states-empty')).toBeTruthy();
        expect(repositories.commerce.getMyOrder).not.toHaveBeenCalled();

        // Nothing to show, so the one action is the history — by name, as from the trail.
        await fireEvent.press(screen.getByTestId('customer-order-history'));
        expect(routerMock.__router.dismissTo).toHaveBeenCalledWith(ORDER_HISTORY_HREF);
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
