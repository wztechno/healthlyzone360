import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * `/kitchen/dressings/{product}` — where a dressing's page used to be.
 *
 * The id is the catalogue item's, not a recipe's, so it goes to the recipe book's item address,
 * which hands over to the dressing's recipe — or, for a dressing with none yet, offers to start
 * one. `new` goes to the book's create form for a dressing. No record is read here: a redirect is
 * not a destination, and `entity-registry.test.ts` skips it for the reason it skips `_layout`.
 */
export default function KitchenDressingEditor() {
    const { product } = useLocalSearchParams<{ product?: string }>();
    const href =
        product === undefined || product === 'new'
            ? '/kitchen/recipes/new?kind=dressing'
            : `/kitchen/recipes/item/${encodeURIComponent(product)}?kind=dressing`;

    return <Redirect href={href as never} />;
}
