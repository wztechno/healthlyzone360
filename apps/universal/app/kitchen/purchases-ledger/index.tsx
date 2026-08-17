import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

const PurchasesLedgerScreen = lazyScreen(
    'kitchen-purchases-ledger-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts'))
            .PurchasesLedgerScreen,
);

/**
 * `?supplier=` and `?item=` are the two deep links into the ledger (SUP2) — from a supplier's page
 * and from a stock row's **History** — and `?mode=weekly|monthly` opens the summary directly (SUP6).
 * They are read here and handed down as props, which the screen uses to *seed* its filters and its
 * mode rather than to drive them: somebody who followed a link must be able to widen the view they
 * landed on, and to switch back to the lines behind it.
 */
export default function KitchenPurchasesLedger() {
    const { supplier, item, mode } = useLocalSearchParams<{
        supplier?: string;
        item?: string;
        mode?: string;
    }>();

    return <PurchasesLedgerScreen supplier={supplier} item={item} mode={mode} />;
}
