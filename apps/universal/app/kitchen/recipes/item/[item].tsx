import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/recipes/item/{item}?kind=…` — a catalogue item, addressed before it is known by its
 * recipe.
 *
 * The old meal, sauce, dressing and frozen-meal editor addresses land here, and so does the review
 * queue's link for a meal with no recipe yet. An item with a recipe is replaced by the recipe's own
 * page at once; one without is where its formulation is started. `?kind=` says which endpoint the id
 * belongs to — a meal and a packaged kind are read apart — and an address without one is answered
 * as not found rather than guessed at.
 *
 * Nested under `/kitchen/recipes`, so the rail, the trail and the registry file it under the book.
 */
const CookedItemEditScreen = lazyScreen(
    'kitchen-recipe-item-loading',
    async () =>
        (await import('../../../../src/features/kitchen-admin/screens/index.ts'))
            .CookedItemEditScreen,
);

export default function KitchenRecipeItem() {
    const { item, kind } = useLocalSearchParams<{ item?: string; kind?: string }>();
    return <CookedItemEditScreen item={item} kind={kind} />;
}
