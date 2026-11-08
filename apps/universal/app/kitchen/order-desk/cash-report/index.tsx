import { Redirect } from 'expo-router';

/**
 * `/kitchen/order-desk/cash-report` — where the cash report used to be. It is the Cash taken tab
 * of the Cash page now, and this stays so a bookmark or an old alert link still arrives. A
 * redirect is not a page: `entity-registry.test.ts` skips it.
 */
export default function KitchenOrderDeskCashReport() {
    return <Redirect href={'/kitchen/order-desk/cash?tab=taken' as never} />;
}
