import type { KitchenOrder, OrderRefundLedger } from '@healthy360/api-client/contracts';
import type { IsoDateTime } from '@healthy360/domain-types';
import { OrderId } from '@healthy360/domain-types';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { OrderRefundsSection } from './order-refunds-section.tsx';

const ORDER = {
    id: OrderId('order-0001'),
    orderNumber: 'HZ-1001',
    currencyCode: 'USD',
    paymentMethod: 'cash_on_delivery',
} as KitchenOrder;

function ledger(overrides: Partial<OrderRefundLedger> = {}): OrderRefundLedger {
    return {
        receivedMinor: 10000,
        refundedMinor: 0,
        correctedMinor: 0,
        pendingMinor: 0,
        refundableMinor: 10000,
        windowClosesAt: '2999-01-01T00:00:00Z' as IsoDateTime,
        entries: [],
        ...overrides,
    };
}

const PENDING: OrderRefundLedger['entries'][number] = {
    id: 'refund-1',
    kind: 'refund',
    status: 'pending_approval',
    method: 'cash_on_delivery',
    amountMinor: 6000,
    reason: 'Cold on arrival',
    requestedByName: 'Sara',
    requestedAt: '2026-11-01T10:00:00Z' as IsoDateTime,
    decidedByName: null,
    decidedAt: null,
};

describe('the refund part of the order record', () => {
    it('sends the reason and the amount, and says when it waits for the owner', async () => {
        const recordRefund = jest.fn(async () =>
            ledger({ pendingMinor: 6000, refundableMinor: 4000, entries: [PENDING] }),
        );

        await renderStubScreen(<OrderRefundsSection order={ORDER} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOrders: { getRefunds: async () => ledger(), recordRefund },
            },
        });

        fireEvent.press(await screen.findByTestId('kitchen-orders-refund-open'));
        fireEvent.changeText(screen.getByTestId('kitchen-orders-refund-amount'), '60.00');
        fireEvent.press(screen.getByTestId('kitchen-orders-refund-confirm'));
        expect(recordRefund).not.toHaveBeenCalled();

        fireEvent.changeText(screen.getByTestId('kitchen-orders-refund-reason'), 'Cold on arrival');
        fireEvent.press(screen.getByTestId('kitchen-orders-refund-confirm'));

        await waitFor(() => {
            expect(recordRefund).toHaveBeenCalledWith({
                orderId: ORDER.id,
                kind: 'refund',
                method: 'cash_on_delivery',
                amountMinor: 6000,
                reason: 'Cold on arrival',
            });
        });
    });

    it('offers nothing once the seven days have passed', async () => {
        await renderStubScreen(<OrderRefundsSection order={ORDER} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOrders: {
                    getRefunds: async () =>
                        ledger({ windowClosesAt: '2001-01-01T00:00:00Z' as IsoDateTime }),
                },
            },
        });

        expect(await screen.findByTestId('kitchen-orders-refunds-closed')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-orders-refund-open')).toBeNull();
    });

    it('shows a manager a waiting entry without the owner buttons', async () => {
        await renderStubScreen(<OrderRefundsSection order={ORDER} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOrders: {
                    getRefunds: async () => ledger({ pendingMinor: 6000, entries: [PENDING] }),
                },
            },
        });

        expect(await screen.findByTestId('kitchen-orders-refund-refund-1')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-orders-refund-refund-1-approve')).toBeNull();
    });
});
