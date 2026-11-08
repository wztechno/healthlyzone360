import type {
    DailyCloseRecord,
    DishMargins,
    OrderDeskCloses,
    Payables,
} from '@healthy360/api-client/contracts';
import type { CurrencyCode, IsoDateTime } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Dimensions } from 'react-native';

import {
    KITCHEN_MANAGER_PERMISSIONS,
    kitchenManagerSession,
    testActiveContext,
} from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { DishMarginsScreen } from './screens/dish-margins-screen.tsx';
import { OrderDeskCloseScreen } from './screens/order-desk-close-screen.tsx';
import { PayablesScreen } from './screens/payables-screen.tsx';

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
/* `mock`-prefixed so the factory below may close over it — Jest's hoisting rule. */
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kitchen/order-desk/close',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

const USD = 'USD' as CurrencyCode;

const CLOSES: OrderDeskCloses = {
    timezone: 'Asia/Beirut',
    branches: [{ id: 'branch-main', name: 'Main kitchen' }],
    open: [
        {
            branchId: 'branch-main',
            branchName: 'Main kitchen',
            currencyCode: USD,
            businessDate: '2026-11-03',
            openedAt: '2026-11-03T06:00:00Z' as IsoDateTime,
            suggestedFloatMinor: 5000,
            counterCashMinor: 3000,
            handedInMinor: 2000,
            cashRefundsMinor: 500,
        },
    ],
    totals: [],
    closes: [],
};

const SHORT_CLOSE: DailyCloseRecord = {
    id: 'close-1',
    branchId: 'branch-main',
    branchName: 'Main kitchen',
    currencyCode: USD,
    businessDate: '2026-11-03',
    openedAt: '2026-11-03T06:00:00Z' as IsoDateTime,
    closedAt: '2026-11-03T18:00:00Z' as IsoDateTime,
    openingFloatMinor: 5000,
    counterCashMinor: 3000,
    handedInMinor: 2000,
    cashRefundsMinor: 500,
    expectedMinor: 9500,
    countedMinor: 9000,
    varianceMinor: -500,
    varianceReason: 'Change',
    recordedByName: 'Sara',
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

describe('the daily close', () => {
    it('asks why a count is short before it can be recorded', async () => {
        const recordClose = jest.fn(async () => SHORT_CLOSE);

        await renderStubScreen(<OrderDeskCloseScreen />, {
            session: kitchenManagerSession(),
            repositories: { orderDesk: { getCloses: async () => CLOSES, recordClose } },
        });

        fireEvent.press(await screen.findByTestId('kitchen-close-branch-main-USD-open'));
        expect((await screen.findByTestId('kitchen-close-float-input')).props.value).toBe('50.00');

        await type('kitchen-close-counted-input', '90.00');
        expect(screen.getByTestId('kitchen-close-short')).toBeTruthy();

        fireEvent.press(screen.getByTestId('kitchen-close-confirm'));
        expect(recordClose).not.toHaveBeenCalled();

        await type('kitchen-close-reason-input', 'Change');
        fireEvent.press(screen.getByTestId('kitchen-close-confirm'));

        await waitFor(() => {
            expect(recordClose).toHaveBeenCalledWith({
                branchId: 'branch-main',
                currencyCode: USD,
                openingFloatMinor: 5000,
                countedMinor: 9000,
                varianceReason: 'Change',
            });
        });
    });

    it('offers a manager the sign-off on a short close, and says which clock it reads', async () => {
        await renderStubScreen(<OrderDeskCloseScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                orderDesk: {
                    getCloses: async () => ({ ...CLOSES, open: [], closes: [SHORT_CLOSE] }),
                },
            },
        });

        expect(await screen.findByTestId('kitchen-close-close-1-sign-off')).toBeTruthy();
        expect(screen.getByTestId('kitchen-close-clock')).toHaveTextContent(/Asia\/Beirut/u);
    });

    it('keeps one branch the page it was: no picker and no kitchen total', async () => {
        await renderStubScreen(<OrderDeskCloseScreen />, {
            session: kitchenManagerSession(),
            repositories: { orderDesk: { getCloses: async () => CLOSES } },
        });

        expect(await screen.findByTestId('kitchen-close-branch-main-USD-open')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-close-branch')).toBeNull();
        expect(screen.queryByTestId('kitchen-close-total')).toBeNull();
    });

    it('closes each branch on its own till, and shows the kitchen total', async () => {
        const recordClose = jest.fn(async () => SHORT_CLOSE);
        const twoTills: OrderDeskCloses = {
            ...CLOSES,
            branches: [
                { id: 'branch-main', name: 'Main kitchen' },
                { id: 'branch-two', name: 'Hamra' },
            ],
            open: [
                ...CLOSES.open,
                {
                    branchId: 'branch-two',
                    branchName: 'Hamra',
                    currencyCode: USD,
                    businessDate: '2026-11-03',
                    openedAt: '2026-11-03T06:00:00Z' as IsoDateTime,
                    suggestedFloatMinor: 0,
                    counterCashMinor: 1000,
                    handedInMinor: 0,
                    cashRefundsMinor: 0,
                },
            ],
            totals: [
                {
                    businessDate: '2026-11-02',
                    currencyCode: USD,
                    tillCount: 2,
                    counterCashMinor: 4000,
                    handedInMinor: 0,
                    cashRefundsMinor: 0,
                    countedMinor: 4600,
                    varianceMinor: -100,
                },
            ],
        };

        await renderStubScreen(<OrderDeskCloseScreen />, {
            session: kitchenManagerSession(),
            repositories: { orderDesk: { getCloses: async () => twoTills, recordClose } },
        });

        expect(await screen.findByTestId('kitchen-close-total')).toHaveTextContent(/\$46\.00/u);
        expect(screen.getByTestId('kitchen-close-branch-main-USD-open')).toBeTruthy();

        fireEvent.press(screen.getByTestId('kitchen-close-branch-trigger'));
        fireEvent.press(await screen.findByTestId('kitchen-close-branch-option-branch-two'));

        await waitFor(() => {
            expect(screen.queryByTestId('kitchen-close-branch-main-USD-open')).toBeNull();
        });

        fireEvent.press(screen.getByTestId('kitchen-close-branch-two-USD-open'));
        await type('kitchen-close-counted-input', '10.00');
        fireEvent.press(screen.getByTestId('kitchen-close-confirm'));

        await waitFor(() => {
            expect(recordClose).toHaveBeenCalledWith({
                branchId: 'branch-two',
                currencyCode: USD,
                openingFloatMinor: 0,
                countedMinor: 1000,
            });
        });
    });
});

describe('payables', () => {
    it('shows a price waiting without offering a reader the act', async () => {
        const payables: Payables = {
            today: '2026-11-03',
            totals: [{ currencyCode: 'USD', amount: '120.000000' }],
            unpaid: [
                {
                    id: 'receipt-1',
                    supplierName: { en: 'Gulf Fresh', ar: '' },
                    documentRef: 'DN-1',
                    supplierInvoiceRef: null,
                    receivedOn: '2026-10-01',
                    dueOn: '2026-10-31',
                    isOverdue: true,
                    paymentStatus: 'unpaid',
                    paidAt: null,
                    paidReference: null,
                    priceApprovalStatus: 'pending',
                    amount: '120.000000',
                    currencyCode: 'USD',
                    priceRises: [
                        {
                            nameEn: 'Olive oil',
                            lastUnitPriceAmount: '10.000000',
                            unitPriceAmount: '12.000000',
                            priceVariancePercent: '20.00',
                        },
                    ],
                },
            ],
            paid: [],
        };

        await renderStubScreen(<PayablesScreen />, {
            session: kitchenManagerSession(),
            repositories: { kitchenOps: { getPayables: async () => payables } },
        });

        expect(await screen.findByText('Gulf Fresh')).toBeTruthy();
        expect(screen.getByTestId('kitchen-payables-totals')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-payable-receipt-1-review')).toBeNull();
    });
});

describe('dish margins', () => {
    const margins: DishMargins = {
        targetPercent: 30,
        computedAt: '2026-11-03T02:00:00Z' as IsoDateTime,
        dishes: [
            {
                id: 'margin-1',
                catalogueItemId: 'item-1',
                name: { en: 'Chicken bowl', ar: '' },
                itemType: 'meal',
                channel: 'b2c',
                priceAmount: '10.000000',
                costAmount: '8.000000',
                currencyCode: 'USD',
                marginPercent: '20.00',
                withheldReason: null,
                isBelowTarget: true,
            },
            {
                id: 'margin-2',
                catalogueItemId: 'item-2',
                name: { en: 'Green salad', ar: '' },
                itemType: 'dressing',
                channel: 'b2c',
                priceAmount: null,
                costAmount: null,
                currencyCode: null,
                marginPercent: null,
                withheldReason: 'cost_incomplete',
                isBelowTarget: false,
            },
        ],
    };

    beforeEach(() => {
        mockPush.mockClear();
    });

    it('shows a reason instead of a number when the margin is withheld', async () => {
        await renderStubScreen(<DishMarginsScreen />, {
            session: kitchenManagerSession(),
            repositories: { kitchenOps: { getDishMargins: async () => margins } },
        });

        expect(await screen.findByText('Below target')).toBeTruthy();
        expect(screen.getByText('Withheld: cost incomplete')).toBeTruthy();
        expect(screen.getByTestId('kitchen-dish-margin-margin-2')).toHaveTextContent('—');
    });

    it('opens the dish recipe from a row, and its price from the row action, coming back here', async () => {
        await renderStubScreen(<DishMarginsScreen />, {
            session: kitchenManagerSession(),
            repositories: { kitchenOps: { getDishMargins: async () => margins } },
        });

        const row = await screen.findByTestId('kitchen-dish-margins-table-row-margin-1');
        await act(async () => {
            fireEvent.press(row);
        });
        expect(mockPush).toHaveBeenLastCalledWith(
            '/kitchen/recipes/item/item-1?kind=meal&tab=production&returnTo=%252Fkitchen%252Fdish-margins',
        );

        await act(async () => {
            fireEvent.press(
                screen.getByTestId('kitchen-dish-margins-table-row-margin-2-action-price'),
            );
        });
        expect(mockPush).toHaveBeenLastCalledWith(
            '/kitchen/recipes/item/item-2?kind=dressing&tab=selling&returnTo=%252Fkitchen%252Fdish-margins',
        );
    });

    it('offers no way into a recipe to a reader without recipe.view', async () => {
        await renderStubScreen(<DishMarginsScreen />, {
            session: kitchenManagerSession({
                activeContext: testActiveContext({
                    permissions: KITCHEN_MANAGER_PERMISSIONS.filter(
                        (code) => code !== 'recipe.view_organisation',
                    ),
                }),
            }),
            repositories: { kitchenOps: { getDishMargins: async () => margins } },
        });

        expect(await screen.findByText('Below target')).toBeTruthy();
        expect(
            screen.queryByTestId('kitchen-dish-margins-table-row-margin-1-action-recipe'),
        ).toBeNull();
        expect(
            screen.queryByTestId('kitchen-dish-margins-table-row-margin-1-action-price'),
        ).toBeNull();
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-dish-margins-table-row-margin-1'));
        });
        expect(mockPush).not.toHaveBeenCalled();
    });
});
