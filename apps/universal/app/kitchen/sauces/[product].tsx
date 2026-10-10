import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * `/kitchen/sauces/{product}` — where a sauce's page used to be.
 *
 * The id is the catalogue item's, not a recipe's, so it goes to the recipe book's item address,
 * which hands over to the sauce's recipe — or, for a sauce with none yet, offers to start one. `new`
 * goes to the book's create form for a sauce. No record is read here: a redirect is not a
 * destination, and `entity-registry.test.ts` skips it for the reason it skips `_layout`.
 */
export default function KitchenSauceEditor() {
    const { product } = useLocalSearchParams<{ product?: string }>();
    const href =
        product === undefined || product === 'new'
            ? '/kitchen/recipes/new?kind=sauce'
            : `/kitchen/recipes/item/${encodeURIComponent(product)}?kind=sauce`;

    return <Redirect href={href as never} />;
}
