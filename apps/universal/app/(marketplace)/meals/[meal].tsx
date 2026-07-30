import { useLocalSearchParams } from 'expo-router';

import { MealDetailScreen } from '../../../src/features/catalogue/screens/meal-detail-screen.tsx';

/** `/meals/{meal}` — one marketplace meal, with its full nutrition record. */
export default function MealDetail() {
    const { meal } = useLocalSearchParams<{ meal?: string }>();
    return <MealDetailScreen mealId={meal} />;
}
