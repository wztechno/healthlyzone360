import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/procurement/new` — post a goods receipt: a market purchase, with no order behind it.
 *
 * Beside `receive.tsx`, which is the ordered delivery. Expo Router prefers this static match, so
 * "new" is never read as anything else under procurement.
 *
 * `?ingredient=` or `?item=` opens the first line on that shelf, and `?returnTo=` is where the
 * posted receipt and Cancel go — a stock gap's Add stock sends all of them.
 */
const PostReceiptScreen = lazyScreen(
    'kitchen-post-receipt-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).PostReceiptScreen,
);

export default function KitchenPostReceipt() {
    const { ingredient, item, returnTo } = useLocalSearchParams<{
        ingredient?: string;
        item?: string;
        returnTo?: string;
    }>();
    return <PostReceiptScreen ingredient={ingredient} item={item} returnTo={returnTo} />;
}
