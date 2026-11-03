import type { KitchenOrder, KitchenOrderLine } from '@healthy360/api-client/contracts';
import type { OrderId } from '@healthy360/domain-types';
import { fireEvent, screen, within } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { TEST_BRANCH_ID, kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { KdsTicketPrintScreen } from './ticket-print-sheet.tsx';

jest.mock('expo-router', () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot import
    require('../../testing/expo-router-mock.ts').createExpoRouterMock({ pathname: '/kds/ticket' }),
);

// A real UUIDv7: the screen parses the query parameter, and anything else reads as no order.
const ORDER_ID = '01935f6c-1a2b-7c3d-8e4f-0123456789ab' as OrderId;

const LINE: KitchenOrderLine = {
    id: 'test-order-line-1',
    catalogueItemId: 'test-catalogue-item-1',
    catalogueItemVariantId: null,
    nameEn: 'Chicken bowl',
    nameAr: 'وعاء دجاج',
    variantLabel: null,
    quantity: '2.000',
    unitPriceMinor: 4_250,
    lineTotalMinor: 8_500,
    currencyCode: 'AED',
    allergens: [],
    packSummary: null,
    options: [
        {
            id: 'test-option-1',
            kind: 'remove',
            groupEn: null,
            groupAr: null,
            nameEn: 'Coriander',
            nameAr: 'كزبرة',
        },
    ],
    note: 'Sauce on the side',
    priceListId: null,
    priceListItemId: null,
};

const ORDER: KitchenOrder = {
    id: ORDER_ID,
    orderNumber: 'VK-2026-0100',
    branchId: TEST_BRANCH_ID,
    status: 'confirmed',
    currencyCode: 'AED',
    subtotalMinor: 8_500,
    deliveryFeeMinor: null,
    totalMinor: 8_500,
    paymentMethod: 'cash_on_delivery',
    fulfilmentType: 'pickup',
    delivery: {
        label: null,
        lineOne: null,
        lineTwo: null,
        city: null,
        areaNameEn: null,
        areaNameAr: null,
        areaId: null,
        windowCode: null,
        requestedDate: null,
        zoneId: null,
    },
    placedAt: new Date().toISOString(),
    confirmedAt: null,
    fulfilledAt: null,
    cancelledAt: null,
    cancellationReason: null,
    lockVersion: 1,
    customerAccountId: null,
    amendable: false,
    allergy: {
        severe: true,
        items: [
            {
                allergenCode: 'sesame',
                severity: 'anaphylaxis',
                notes: null,
                conflictsWithLine: [],
            },
        ],
        note: 'Carries an adrenaline pen',
        acknowledgedAt: null,
    },
    lineCount: 1,
    lines: [LINE],
};

async function renderTicket() {
    return renderStubScreen(<KdsTicketPrintScreen order={String(ORDER_ID)} />, {
        session: kitchenManagerSession(),
        repositories: {
            kitchenOrders: {
                getDisplay: async () => ({
                    orders: [ORDER],
                    truncated: false,
                    alarmAfterMinutes: 10,
                    unacceptedOpenMinutes: {},
                }),
            },
        },
    });
}

describe('the printed kitchen ticket', () => {
    it('carries the allergy in words, the options and the note, and no money', async () => {
        await renderTicket();

        const sheet = await screen.findByTestId('kds-ticket-print-sheet');
        expect(within(sheet).getByText('VK-2026-0100')).toBeTruthy();

        const allergy = within(sheet).getByTestId('kds-ticket-print-sheet-allergy');
        expect(allergy).toHaveTextContent(/Severe allergy on this order/);
        expect(allergy).toHaveTextContent(/Carries an adrenaline pen/);

        expect(
            within(sheet).getByTestId(`kds-ticket-print-sheet-line-${LINE.id}-options`),
        ).toHaveTextContent(/Coriander/);
        expect(
            within(sheet).getByTestId(`kds-ticket-print-sheet-line-${LINE.id}-note`),
        ).toHaveTextContent(/Sauce on the side/);

        expect(sheet).not.toHaveTextContent(/AED|85\.00|42\.50/);
    });

    it('never opens the print dialog by itself, only from the button', async () => {
        // As the browser: the default jest-expo platform has no print, so nothing could be called.
        const os = jest.replaceProperty(Platform, 'OS', 'web');
        const print = jest.fn();
        const original = window.print;
        window.print = print;
        try {
            await renderTicket();
            await screen.findByTestId('kds-ticket-print-sheet');
            const action = screen.getByTestId('kds-ticket-print-action');
            expect(print).not.toHaveBeenCalled();

            fireEvent.press(action);
            expect(print).toHaveBeenCalledTimes(1);
        } finally {
            window.print = original;
            os.restore();
        }
    });
});
