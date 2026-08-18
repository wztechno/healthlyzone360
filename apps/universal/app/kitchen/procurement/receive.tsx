import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/procurement/receive?order=…` — booking in a delivery (SUP5).
 *
 * The order is a query parameter rather than a path segment because the screen is reachable both
 * ways: from an order's own detail with the order fixed, and from the procurement hub with a picker.
 * A path segment would make the second case an awkward second route for one screen.
 *
 * It lives under `procurement/` rather than `supply-orders/` deliberately. Receiving takes
 * `inventory.manage_organisation`, not the order-supplies code, and the shell resolves breadcrumbs
 * by route prefix — so a receiver who cannot open the order book still lands under a family they
 * can see.
 */
const ReceiveDeliveryScreen = lazyScreen(
    'kitchen-receive-delivery-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts'))
            .ReceiveDeliveryScreen,
);

export default function KitchenReceiveDelivery() {
    const { order } = useLocalSearchParams<{ order?: string }>();
    return <ReceiveDeliveryScreen order={order} />;
}
