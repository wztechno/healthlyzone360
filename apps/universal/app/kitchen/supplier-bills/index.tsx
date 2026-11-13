import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/supplier-bills` — receipts to price and bills to pay, one tab each. */
const SupplierBillsScreen = lazyScreen(
    'kitchen-supplier-bills-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).SupplierBillsScreen,
);

export default function KitchenSupplierBills() {
    return <SupplierBillsScreen />;
}
