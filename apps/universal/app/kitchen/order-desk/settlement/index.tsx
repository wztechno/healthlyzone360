import { Redirect } from 'expo-router';

/**
 * `/kitchen/order-desk/settlement` — where cash settlement used to be. It is the Settle cash tab
 * of the Cash page now, and this stays so a bookmark or an old alert link still arrives. A
 * redirect is not a page: `entity-registry.test.ts` skips it.
 */
export default function KitchenOrderDeskSettlement() {
    return <Redirect href={'/kitchen/order-desk/cash?tab=handins' as never} />;
}
