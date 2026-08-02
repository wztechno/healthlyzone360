import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/ingredients` — the ingredient list, with its filters and the create affordance. */
const IngredientsScreen = lazyScreen(
    'kitchen-ingredients-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).IngredientsScreen,
);

export default function KitchenIngredients() {
    return <IngredientsScreen />;
}
