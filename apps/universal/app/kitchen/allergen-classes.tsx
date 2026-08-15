import { lazyScreen } from '../../src/shell/lazy-screen.tsx';

/** `/kitchen/allergen-classes` — the platform allergen reference, read only (decision D-041). */
const AllergenClassesScreen = lazyScreen(
    'kitchen-allergen-classes-loading',
    async () =>
        (await import('../../src/features/kitchen-admin/screens/index.ts')).AllergenClassesScreen,
);

export default function KitchenAllergenClasses() {
    return <AllergenClassesScreen />;
}
