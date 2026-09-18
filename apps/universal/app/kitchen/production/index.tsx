import { Redirect } from 'expo-router';

/**
 * `/kitchen/production` — where the batch list used to be.
 *
 * It moved to `/kitchen/production-desk` when the desk landed, and this stays so a bookmark, a
 * pasted link or a stale role-editor row still arrives somewhere. A redirect is not a destination:
 * it has no gate of its own, appears in no registry family, and `entity-registry.test.ts` skips it
 * for the reason it skips `_layout` — neither is a page.
 */
export default function KitchenProduction() {
    return <Redirect href="/kitchen/production-desk" />;
}
