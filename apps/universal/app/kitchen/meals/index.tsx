import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/meals` — the dishes this kitchen sells, and which of them consumers can see. */
const MealsScreen = lazyScreen(
    'kitchen-meals-loading',
    async () => (await import('../../../src/features/kitchen-admin/screens/index.ts')).MealsScreen,
);

export default function KitchenMeals() {
    return <MealsScreen />;
}
