import { fireEvent, screen } from '@testing-library/react-native';
import type { Text as NativeText } from 'react-native';

import { kitchenManagerSession, testActiveContext } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { OrderDeskCashScreen } from './screens/order-desk-cash-screen.tsx';

/* `mock`-prefixed so the factories below may close over them — Jest's hoisting rule. */
const mockSetParams = jest.fn();
let mockParams: { tab?: string } = {};
jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({
        push: jest.fn(),
        replace: jest.fn(),
        back: jest.fn(),
        setParams: mockSetParams,
    }),
    usePathname: () => '/kitchen/order-desk/cash',
    useLocalSearchParams: () => mockParams,
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

// The tabs are the old screens, unchanged and tested on their own; here they only need to say which.
jest.mock('./screens/order-desk-cash-report-screen.tsx', () => {
    const { Text } = jest.requireActual<{ Text: typeof NativeText }>('react-native');
    return { OrderDeskCashReportScreen: () => <Text testID="stub-taken">taken</Text> };
});
jest.mock('./screens/order-desk-settlement-screen.tsx', () => {
    const { Text } = jest.requireActual<{ Text: typeof NativeText }>('react-native');
    return { OrderDeskSettlementScreen: () => <Text testID="stub-handins">handins</Text> };
});
jest.mock('./screens/order-desk-close-screen.tsx', () => {
    const { Text } = jest.requireActual<{ Text: typeof NativeText }>('react-native');
    return { OrderDeskCloseScreen: () => <Text testID="stub-close">close</Text> };
});

const MANAGE = 'order.manage_organisation';
const SETTLE = 'order.settle_cash_organisation';

/** The kitchen manager, less whichever of the two cash codes `drop` names. */
function sessionWithout(...drop: string[]) {
    const context = testActiveContext();
    return kitchenManagerSession({
        activeContext: {
            ...context,
            permissions: context.permissions.filter((code) => !drop.includes(code)),
        },
    });
}

beforeEach(() => {
    mockSetParams.mockClear();
    mockParams = {};
});

describe('the Cash page', () => {
    it('offers all three tabs to somebody holding both codes, and opens on Cash taken', async () => {
        await renderStubScreen(<OrderDeskCashScreen />, { session: sessionWithout() });

        expect(await screen.findByTestId('stub-taken')).toBeTruthy();
        expect(screen.getByTestId('kitchen-cash-tab-taken')).toBeTruthy();
        expect(screen.getByTestId('kitchen-cash-tab-handins')).toBeTruthy();
        expect(screen.getByTestId('kitchen-cash-tab-close')).toBeTruthy();

        fireEvent.press(screen.getByTestId('kitchen-cash-tab-close'));
        expect(mockSetParams).toHaveBeenCalledWith({ tab: 'close' });
    });

    it('opens the tab ?tab= names', async () => {
        mockParams = { tab: 'handins' };
        await renderStubScreen(<OrderDeskCashScreen />, { session: sessionWithout() });

        expect(await screen.findByTestId('stub-handins')).toBeTruthy();
        expect(screen.queryByTestId('stub-taken')).toBeNull();
    });

    it('gives the manage code alone only Cash taken, whatever ?tab= asks', async () => {
        mockParams = { tab: 'close' };
        await renderStubScreen(<OrderDeskCashScreen />, { session: sessionWithout(SETTLE) });

        expect(await screen.findByTestId('stub-taken')).toBeTruthy();
        expect(screen.queryByTestId('stub-close')).toBeNull();
        expect(screen.queryByTestId('kitchen-cash-tab-handins')).toBeNull();
        expect(screen.queryByTestId('kitchen-cash-tab-close')).toBeNull();
    });

    it('gives the settle code alone the hand-ins and the close, falling to hand-ins', async () => {
        mockParams = { tab: 'taken' };
        await renderStubScreen(<OrderDeskCashScreen />, { session: sessionWithout(MANAGE) });

        expect(await screen.findByTestId('stub-handins')).toBeTruthy();
        expect(screen.queryByTestId('stub-taken')).toBeNull();
        expect(screen.queryByTestId('kitchen-cash-tab-taken')).toBeNull();
        expect(screen.getByTestId('kitchen-cash-tab-close')).toBeTruthy();
    });

    it('refuses somebody holding neither', async () => {
        await renderStubScreen(<OrderDeskCashScreen />, {
            session: sessionWithout(MANAGE, SETTLE),
        });

        expect(await screen.findByTestId('kitchen-order-desk-cash-forbidden')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-cash-screen')).toBeNull();
    });
});
