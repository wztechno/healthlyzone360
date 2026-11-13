import { Redirect } from 'expo-router';

/**
 * `/kitchen/procurement/unpriced-receipts` — where the unpriced-receipt queue used to be. It is the
 * To price tab of Supplier bills now, and this stays so a bookmark still arrives. A redirect is not
 * a page: `entity-registry.test.ts` skips it.
 */
export default function KitchenUnpricedReceipts() {
    return <Redirect href={'/kitchen/supplier-bills?tab=unpriced' as never} />;
}
