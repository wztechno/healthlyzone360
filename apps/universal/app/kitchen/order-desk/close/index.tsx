import { Redirect } from 'expo-router';

/**
 * `/kitchen/order-desk/close` — where the daily close used to be. It is the Daily close tab of the
 * Cash page now, and this stays so a bookmark or an old alert link still arrives. A redirect is
 * not a page: `entity-registry.test.ts` skips it.
 */
export default function KitchenOrderDeskClose() {
    return <Redirect href={'/kitchen/order-desk/cash?tab=close' as never} />;
}
