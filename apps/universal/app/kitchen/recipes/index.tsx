import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/recipes` — the recipe book, with its filters and the create affordance. */
const RecipesScreen = lazyScreen(
    'kitchen-recipes-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).RecipesScreen,
);

export default function KitchenRecipes() {
    // `?view=`: the record whose page is open, so an editor sent from it comes back to it.
    const { view } = useLocalSearchParams<{ view?: string }>();
    return <RecipesScreen view={view} />;
}
