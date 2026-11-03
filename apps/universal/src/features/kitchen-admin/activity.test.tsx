import type { StockActivity } from '@healthy360/api-client/contracts';
import type { IsoDateTime } from '@healthy360/domain-types';
import { screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';

import { permissionsAdministratorSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { ActivityScreen } from './screens/activity-screen.tsx';

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
    usePathname: () => '/kitchen/activity',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

const ACTIVITY: StockActivity = {
    movements: [
        {
            id: 'movement-1',
            at: '2026-11-01T10:00:00Z' as IsoDateTime,
            itemName: 'Flour',
            unit: 'kg',
            reason: 'adjust',
            quantityDelta: '-2.0000',
            costMinor: null,
            currencyCode: null,
            notes: null,
            wasteReason: null,
            orderId: null,
            orderNumber: null,
            wastedOrder: false,
            attributed: false,
            actorName: null,
        },
    ],
    waste: [],
    unvaluedWasteCount: 2,
    truncated: false,
};

describe('the Activity page', () => {
    it('reads an old movement as unattributed, and says waste went unvalued', async () => {
        await renderStubScreen(<ActivityScreen />, {
            session: permissionsAdministratorSession(),
            repositories: { kitchenOps: { getStockActivity: async () => ACTIVITY } },
        });

        expect(await screen.findByText('Unattributed')).toBeTruthy();
        expect(screen.getByTestId('kitchen-activity-unvalued')).toBeTruthy();
    });

    it('names why food was wasted, and opens the order a movement served', async () => {
        const base = ACTIVITY.movements[0];
        if (base === undefined) throw new Error('fixture has a movement');
        await renderStubScreen(<ActivityScreen />, {
            session: permissionsAdministratorSession(),
            repositories: {
                kitchenOps: {
                    getStockActivity: async () => ({
                        ...ACTIVITY,
                        movements: [
                            { ...base, id: 'waste-1', reason: 'waste', wasteReason: 'expired' },
                            {
                                ...base,
                                id: 'consume-1',
                                reason: 'consume',
                                orderId: 'order-1',
                                orderNumber: 'HZ-1001',
                            },
                        ],
                    }),
                },
            },
        });

        expect(await screen.findByTestId('kitchen-activity-waste-reason-waste-1')).toHaveTextContent(
            'Expired',
        );
        expect(screen.getByTestId('kitchen-activity-stock-order-consume-1')).toHaveTextContent(
            'HZ-1001',
        );
    });
});
