import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * `/kitchen/meals/{meal}` — where a meal's page used to be.
 *
 * The id is the catalogue item's, not a recipe's, so it goes to the recipe book's item address,
 * which hands over to the meal's recipe — or, for a meal with none yet, offers to start one. `new`
 * goes to the book's create form for a meal. No record is read here: a redirect is not a
 * destination, and `entity-registry.test.ts` skips it for the reason it skips `_layout`.
 */
export default function KitchenMealEditor() {
    const { meal } = useLocalSearchParams<{ meal?: string }>();
    const href =
        meal === undefined || meal === 'new'
            ? '/kitchen/recipes/new?kind=meal'
            : `/kitchen/recipes/item/${encodeURIComponent(meal)}?kind=meal`;

    return <Redirect href={href as never} />;
}
