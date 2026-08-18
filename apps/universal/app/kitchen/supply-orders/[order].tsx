import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/supply-orders/{order}` — one purchase order.
 *
 * The parameter is validated in the screen, so a hand-typed link produces the designed not-found
 * state rather than a repository failure. `new.tsx` sits beside this file and Expo Router prefers
 * the static match, so "new" is never read as an order identifier.
 */
const SupplyOrderDetailScreen = lazyScreen(
    'kitchen-supply-order-detail-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts'))
            .SupplyOrderDetailScreen,
);

export default function KitchenSupplyOrderDetail() {
    const { order } = useLocalSearchParams<{ order?: string }>();
    return <SupplyOrderDetailScreen order={order} />;
}
