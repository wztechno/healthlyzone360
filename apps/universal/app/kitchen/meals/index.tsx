import { Redirect } from 'expo-router';

/**
 * `/kitchen/meals` — where the meal list used to be.
 *
 * Meals are recipes in the recipe book now, under its Meals tab, and this stays so a bookmark, a
 * pasted link or a stale role-editor row still arrives somewhere. A redirect is not a destination:
 * it has no gate of its own, appears in no registry family, and `entity-registry.test.ts` skips it
 * for the reason it skips `_layout` — neither is a page.
 */
export default function KitchenMeals() {
    return <Redirect href={'/kitchen/recipes?kind=meal' as never} />;
}
