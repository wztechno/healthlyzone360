import type { CashSettlementRecord, OrderDeskSettlements } from '@healthy360/api-client/contracts';
import type { IsoDateTime } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Dimensions } from 'react-native';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { OrderDeskSettlementScreen } from './screens/order-desk-settlement-screen.tsx';

/** `CatalogueList` lays out columns from `md`; React Native's Jest window is 750px. */
const narrowWindow = Dimensions.get('window');
beforeAll(() => {
    Dimensions.set({
        window: { ...narrowWindow, width: 1440, height: 900 },
        screen: { ...narrowWindow, width: 1440, height: 900 },
    });
});
afterAll(() => {
    Dimensions.set({ window: narrowWindow, screen: narrowWindow });
});
jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kitchen/order-desk/settlement',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

const SETTLEMENTS: OrderDeskSettlements = {
    drivers: [
        {
            driverUserId: 'driver-1',
            displayName: 'Omar',
            branchId: null,
            branchName: null,
            currencyCode: 'USD',
            collectedMinor: 5000,
            runs: [
                {
                    jobId: 'job-1',
                    orderId: 'order-1',
                    orderNumber: 'HZ-1',
                    deliveredAt: null,
                    amountMinor: 3000,
                },
                {
                    jobId: 'job-2',
                    orderId: 'order-2',
                    orderNumber: 'HZ-2',
                    deliveredAt: null,
                    amountMinor: 2000,
                },
            ],
        },
    ],
    couriers: [],
    settlements: [],
};

const RECORD: CashSettlementRecord = {
    id: 'settlement-1',
    kind: 'driver',
    partyName: 'Omar',
    branchId: null,
    branchName: null,
    currencyCode: 'USD',
    expectedMinor: 5000,
    feeMinor: 0,
    expenseMinor: 0,
    handedInMinor: 4500,
    shortMinor: 500,
    shortReason: 'Change',
    recordedByName: 'Sara',
    recordedAt: '2026-11-01T10:00:00Z' as IsoDateTime,
    signedOffByName: null,
    signedOffAt: null,
};

/** A keystroke in a dialog, flushed before the next line reads the form. */
async function type(testID: string, text: string) {
    const field = await screen.findByTestId(testID);
    await act(async () => {
        fireEvent.changeText(field, text);
    });
}

describe('settling cash', () => {
    it('asks why a hand-in is short before it can be recorded', async () => {
        const recordSettlement = jest.fn(async () => RECORD);

        await renderStubScreen(<OrderDeskSettlementScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                orderDesk: { getSettlements: async () => SETTLEMENTS, recordSettlement },
            },
        });

        fireEvent.press(await screen.findByTestId('kitchen-settlement-driver-driver-1-settle'));
        await type('kitchen-settlement-amount-input', '45.00');
        expect(screen.getByTestId('kitchen-settlement-short')).toBeTruthy();

        fireEvent.press(screen.getByTestId('kitchen-settlement-confirm'));
        expect(recordSettlement).not.toHaveBeenCalled();

        await type('kitchen-settlement-reason-input', 'Change');
        fireEvent.press(screen.getByTestId('kitchen-settlement-confirm'));

        await waitFor(() => {
            expect(recordSettlement).toHaveBeenCalledWith({
                jobIds: ['job-1', 'job-2'],
                handedInMinor: 4500,
                shortReason: 'Change',
            });
        });
    });

    it('offers a manager the sign-off on a short hand-in', async () => {
        await renderStubScreen(<OrderDeskSettlementScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                orderDesk: {
                    getSettlements: async () => ({
                        drivers: [],
                        couriers: [],
                        settlements: [RECORD],
                    }),
                },
            },
        });

        expect(await screen.findByTestId('kitchen-settlement-settlement-1-sign-off')).toBeTruthy();
    });

    it('expects no cash for a prepaid courier run, and shows its fee as a kitchen expense', async () => {
        const recordSettlement = jest.fn(async () => ({
            ...RECORD,
            kind: 'courier' as const,
            partyName: 'Toters',
            expectedMinor: 0,
            handedInMinor: 0,
            shortMinor: 0,
            shortReason: null,
            expenseMinor: 300,
        }));

        await renderStubScreen(<OrderDeskSettlementScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                orderDesk: {
                    getSettlements: async () => ({
                        drivers: [],
                        couriers: [
                            {
                                courierName: 'Toters',
                                branchId: null,
                                branchName: null,
                                currencyCode: 'USD',
                                dueMinor: 0,
                                feeMinor: 0,
                                expenseMinor: 300,
                                runs: [
                                    {
                                        jobId: 'job-9',
                                        orderId: 'order-9',
                                        orderNumber: 'HZ-9',
                                        deliveredAt: null,
                                        amountMinor: 0,
                                        feeMinor: 300,
                                        prepaid: true,
                                        reference: null,
                                    },
                                ],
                            },
                        ],
                        settlements: [],
                    }),
                    recordSettlement,
                },
            },
        });

        expect(await screen.findByTestId('kitchen-settlement-couriers')).toHaveTextContent(
            /\$3\.00/u,
        );
        fireEvent.press(screen.getByTestId('kitchen-settlement-courier-Toters-settle'));
        expect(await screen.findByTestId('kitchen-settlement-expense')).toHaveTextContent(
            /\$3\.00/u,
        );
        expect(screen.getByTestId('kitchen-settlement-fee')).toHaveTextContent(/\$0\.00 is due/u);

        await type('kitchen-settlement-amount-input', '0');
        expect(screen.queryByTestId('kitchen-settlement-short')).toBeNull();
        fireEvent.press(screen.getByTestId('kitchen-settlement-confirm'));

        await waitFor(() => {
            expect(recordSettlement).toHaveBeenCalledWith({ jobIds: ['job-9'], handedInMinor: 0 });
        });
    });
});
