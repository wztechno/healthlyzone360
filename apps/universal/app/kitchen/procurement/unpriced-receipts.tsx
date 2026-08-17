import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/procurement/unpriced-receipts` — the receipts still waiting on their invoices (SUP5).
 *
 * Under `procurement/` beside the receive route, so both new surfaces crumb to the same family the
 * receipts they act on already live in.
 */
const UnpricedReceiptsScreen = lazyScreen(
    'kitchen-unpriced-receipts-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts'))
            .UnpricedReceiptsScreen,
);

export default function KitchenUnpricedReceipts() {
    return <UnpricedReceiptsScreen />;
}
