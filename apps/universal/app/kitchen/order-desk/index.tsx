import { Redirect, useLocalSearchParams } from 'expo-router';

import { ordersHref } from '../../../src/features/kitchen-admin/orders/orders-url.ts';

/**
 * `/kitchen/order-desk` — where the order desk used to be. It is the Today tab of the Orders page
 * now, and this stays so a bookmark or an old link still arrives; `?lens=past_due` (the kitchen
 * home's late link) opens All orders on the late ones. A redirect is not a page:
 * `entity-registry.test.ts` skips it.
 */
export default function KitchenOrderDesk() {
    const { lens } = useLocalSearchParams<{ lens?: string }>();
    const target =
        lens === 'past_due'
            ? ordersHref({ tab: 'all', quick: 'late' })
            : ordersHref({ tab: 'today' });
    return <Redirect href={target as never} />;
}
