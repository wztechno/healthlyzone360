import { useLocalSearchParams } from 'expo-router';

import { DietCategoryScreen } from '../../../src/features/catalogue/screens/diet-category-screen.tsx';

/** `/diets/{diet}` — one diet category, with the meals and plans that match it. */
export default function DietCategory() {
    const { diet } = useLocalSearchParams<{ diet?: string }>();
    return <DietCategoryScreen slug={diet} />;
}
