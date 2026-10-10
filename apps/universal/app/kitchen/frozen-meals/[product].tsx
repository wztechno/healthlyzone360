import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * `/kitchen/frozen-meals/{product}` — where a frozen meal's page used to be.
 *
 * The id is the catalogue item's, not a recipe's, so it goes to the recipe book's item address,
 * which hands over to the frozen meal's recipe — or, for one with none yet, offers to start one.
 * `new` goes to the book's create form for a frozen meal, spelt `frozen_meal` as the server spells
 * the kind. No record is read here: a redirect is not a destination, and `entity-registry.test.ts`
 * skips it for the reason it skips `_layout`.
 */
export default function KitchenFrozenMealEdit() {
    const { product } = useLocalSearchParams<{ product?: string }>();
    const href =
        product === undefined || product === 'new'
            ? '/kitchen/recipes/new?kind=frozen_meal'
            : `/kitchen/recipes/item/${encodeURIComponent(product)}?kind=frozen_meal`;

    return <Redirect href={href as never} />;
}
