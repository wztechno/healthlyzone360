import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/ingredients` — the ingredient list, with its filters and the create affordance. */
const IngredientsScreen = lazyScreen(
    'kitchen-ingredients-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).IngredientsScreen,
);

export default function KitchenIngredients() {
    // `?view=`: the record whose page is open, so an editor sent from it comes back to it.
    const { view } = useLocalSearchParams<{ view?: string }>();
    return <IngredientsScreen view={view} />;
}
