import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/recipes` — the recipe book, with its filters and the create affordance. */
const RecipesScreen = lazyScreen(
    'kitchen-recipes-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).RecipesScreen,
);

export default function KitchenRecipes() {
    return <RecipesScreen />;
}
