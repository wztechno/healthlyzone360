import { Redirect } from 'expo-router';

/**
 * `/kitchen/frozen-meals` — where the frozen-meal list used to be.
 *
 * Frozen meals are recipes in the recipe book now, under its Frozen meals tab, and this stays so a
 * bookmark, a pasted link or a stale role-editor row still arrives somewhere. The kind is spelt the
 * way the server spells it, `frozen_meal`, not the way this address did. A redirect is not a
 * destination: it has no gate of its own, appears in no registry family, and
 * `entity-registry.test.ts` skips it for the reason it skips `_layout` — neither is a page.
 */
export default function KitchenFrozenMeals() {
    return <Redirect href={'/kitchen/recipes?kind=frozen_meal' as never} />;
}
