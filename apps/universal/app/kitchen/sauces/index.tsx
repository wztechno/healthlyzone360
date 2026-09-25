import { Redirect } from 'expo-router';

/**
 * `/kitchen/sauces` — where the sauce and marination list used to be.
 *
 * Sauces are recipes in the recipe book now, under its Sauces & marinations tab, and this stays so a
 * bookmark, a pasted link or a stale role-editor row still arrives somewhere. A redirect is not a
 * destination: it has no gate of its own, appears in no registry family, and
 * `entity-registry.test.ts` skips it for the reason it skips `_layout` — neither is a page.
 */
export default function KitchenSauces() {
    return <Redirect href={'/kitchen/recipes?kind=sauce' as never} />;
}
