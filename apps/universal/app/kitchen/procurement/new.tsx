import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/procurement/new` — post a goods receipt: a market purchase, with no order behind it.
 *
 * Beside `receive.tsx`, which is the ordered delivery. Expo Router prefers this static match, so
 * "new" is never read as anything else under procurement.
 */
const PostReceiptScreen = lazyScreen(
    'kitchen-post-receipt-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).PostReceiptScreen,
);

export default function KitchenPostReceipt() {
    return <PostReceiptScreen />;
}
