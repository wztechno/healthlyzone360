import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/dish-margins` — what each dish earns, behind the recipe cost code. */
const DishMarginsScreen = lazyScreen(
    'kitchen-dish-margins-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).DishMarginsScreen,
);

export default function KitchenDishMargins() {
    return <DishMarginsScreen />;
}
