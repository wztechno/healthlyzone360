import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

const PurchasesLedgerScreen = lazyScreen(
    'kitchen-purchases-ledger-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts'))
            .PurchasesLedgerScreen,
);

export default function KitchenPurchasesLedger() {
    return <PurchasesLedgerScreen />;
}
