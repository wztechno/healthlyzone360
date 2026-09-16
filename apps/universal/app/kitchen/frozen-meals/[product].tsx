import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/frozen-meals/{item}` — one frozen meal, or `new`. */
const FrozenMealEditScreen = lazyScreen(
    'kitchen-frozen-meal-edit-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).FrozenMealEditScreen,
);

export default function KitchenFrozenMealEdit() {
    const { product } = useLocalSearchParams<{ product?: string }>();

    return <FrozenMealEditScreen product={product} />;
}
