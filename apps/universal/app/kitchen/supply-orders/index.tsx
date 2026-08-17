import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/supply-orders` — what this branch is short of, and the way into ordering it.
 *
 * `?created=` is optional and only ever set by the builder replacing itself after a successful
 * batch (SUP7): it carries the new orders' identifiers so the page can offer **Print them**.
 * Arriving here any other way simply has no parameter and no callout.
 */
const SupplyOrdersScreen = lazyScreen(
    'kitchen-supply-orders-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).SupplyOrdersScreen,
);

export default function KitchenSupplyOrders() {
    const { created } = useLocalSearchParams<{ created?: string }>();
    return <SupplyOrdersScreen created={created} />;
}
