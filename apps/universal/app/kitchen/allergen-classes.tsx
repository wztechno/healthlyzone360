import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../src/shell/lazy-screen.tsx';

/** `/kitchen/allergen-classes` — the platform allergen reference, read only (decision D-041). */
const AllergenClassesScreen = lazyScreen(
    'kitchen-allergen-classes-loading',
    async () =>
        (await import('../../src/features/kitchen-admin/screens/index.ts')).AllergenClassesScreen,
);

export default function KitchenAllergenClasses() {
    // `?view=`: the record whose page is open, so an editor sent from it comes back to it.
    const { view } = useLocalSearchParams<{ view?: string }>();
    return <AllergenClassesScreen view={view} />;
}
