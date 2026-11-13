import { Redirect } from 'expo-router';

import { ordersHref } from '../../../../src/features/kitchen-admin/orders/orders-url.ts';

/**
 * `/kitchen/order-desk/calendar` — where the order calendar used to be. It is the Calendar tab of
 * the Orders page now, and this stays so a bookmark or an old link still arrives. A redirect is not
 * a page: `entity-registry.test.ts` skips it.
 */
export default function KitchenOrderDeskCalendar() {
    return <Redirect href={ordersHref({ tab: 'calendar' }) as never} />;
}
