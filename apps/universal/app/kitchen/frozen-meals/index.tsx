import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/frozen-meals` — meals cooked in advance and sold from the freezer, with their packs. */
const FrozenMealsScreen = lazyScreen(
    'kitchen-frozen-meals-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).FrozenMealsScreen,
);

export default function KitchenFrozenMeals() {
    return <FrozenMealsScreen />;
}
