import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * `/kitchen/procurement/unpriced-receipts/{receipt}` — where a receipt's pricing page used to be.
 * It lives under Supplier bills now, and this forwards the id so a bookmark still opens the same
 * receipt. A redirect is not a page: `entity-registry.test.ts` skips it.
 */
export default function KitchenUnpricedReceipt() {
    const { receipt } = useLocalSearchParams<{ receipt?: string }>();
    return <Redirect href={`/kitchen/supplier-bills/${receipt ?? ''}` as never} />;
}
