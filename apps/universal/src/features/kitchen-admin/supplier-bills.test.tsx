import type { UnpricedReceipt } from '@healthy360/api-client/contracts';
import { GoodsReceiptId } from '@healthy360/domain-types';
import { fireEvent, screen } from '@testing-library/react-native';
import type { Text as NativeText } from 'react-native';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { SupplierBillsScreen } from './screens/supplier-bills-screen.tsx';

/* `mock`-prefixed so the factories below may close over them — Jest's hoisting rule. */
const mockSetParams = jest.fn();
const mockPush = jest.fn();
let mockParams: { tab?: string } = {};
jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({
        push: mockPush,
        replace: jest.fn(),
        back: jest.fn(),
        setParams: mockSetParams,
    }),
    usePathname: () => '/kitchen/supplier-bills',
    useLocalSearchParams: () => mockParams,
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

// The To pay tab is the payables screen, unchanged and tested on its own.
jest.mock('./screens/payables-screen.tsx', () => {
    const { Text } = jest.requireActual<{ Text: typeof NativeText }>('react-native');
    return { PayablesScreen: () => <Text testID="stub-bills">bills</Text> };
});

const RECEIPT: UnpricedReceipt = {
    id: GoodsReceiptId.unsafe('01935f6d-0000-7000-8000-00000000b001'),
    receivedOn: '2026-08-01',
    supplier: null,
    documentRef: 'DN-1',
    supplierInvoiceRef: null,
    purchaseOrderId: null,
    costStatus: 'unpriced',
    lineCount: 2,
    unpricedLineCount: 2,
    valuationPendingCount: 0,
};

function render() {
    return renderStubScreen(<SupplierBillsScreen />, {
        session: kitchenManagerSession(),
        repositories: {
            kitchenOps: {
                listUnpricedReceipts: async () => page([RECEIPT]),
                listSuppliers: async () => [],
            },
        },
    });
}

beforeEach(() => {
    mockSetParams.mockClear();
    mockPush.mockClear();
    mockParams = {};
});

describe('the Supplier bills page', () => {
    it('offers both tabs and opens on To price', async () => {
        await render();

        expect(await screen.findByTestId('kitchen-unpriced-table')).toBeTruthy();
        expect(screen.getByTestId('kitchen-supplier-bills-tab-unpriced')).toBeTruthy();
        expect(screen.queryByTestId('stub-bills')).toBeNull();

        fireEvent.press(screen.getByTestId('kitchen-supplier-bills-tab-bills'));
        expect(mockSetParams).toHaveBeenCalledWith({ tab: 'bills' });
    });

    it('lands ?tab=bills on what is owed', async () => {
        mockParams = { tab: 'bills' };
        await render();

        expect(await screen.findByTestId('stub-bills')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-unpriced-table')).toBeNull();
    });

    it('opens a receipt to price at its address under Supplier bills', async () => {
        await render();

        fireEvent.press(
            await screen.findByTestId(`kitchen-unpriced-table-row-${String(RECEIPT.id)}`),
        );
        expect(mockPush).toHaveBeenCalledWith(`/kitchen/supplier-bills/${String(RECEIPT.id)}`);
    });
});
