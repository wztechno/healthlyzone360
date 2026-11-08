import { Redirect } from 'expo-router';

/**
 * `/kitchen/payables` — where the payables list used to be. It is the To pay tab of Supplier bills
 * now, and this stays so a bookmark or an old alert link still arrives. A redirect is not a page:
 * `entity-registry.test.ts` skips it.
 */
export default function KitchenPayables() {
    return <Redirect href={'/kitchen/supplier-bills?tab=bills' as never} />;
}
