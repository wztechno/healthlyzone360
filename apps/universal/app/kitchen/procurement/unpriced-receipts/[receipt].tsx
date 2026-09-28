import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/procurement/unpriced-receipts/{receipt}` — one receipt's missing prices (SUP5).
 *
 * The parameter is validated in the screen, so a hand-typed link produces the designed not-found
 * state rather than a repository failure.
 */
const UnpricedReceiptScreen = lazyScreen(
    'kitchen-unpriced-receipt-loading',
    async () =>
        (await import('../../../../src/features/kitchen-admin/screens/index.ts'))
            .UnpricedReceiptScreen,
);

export default function KitchenUnpricedReceipt() {
    const { receipt } = useLocalSearchParams<{ receipt?: string }>();
    return <UnpricedReceiptScreen receipt={receipt} />;
}
