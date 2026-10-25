import { useLocalSearchParams } from 'expo-router';

import { MealDetailScreen } from '../../../src/features/catalogue/screens/meal-detail-screen.tsx';

/**
 * `/meals/{meal}` — one marketplace meal, with its full nutrition record. `?returnTo=` is the
 * kitchen record a staff member opened it from ("See it on the menu"), and the way back to it.
 */
export default function MealDetail() {
    const { meal, returnTo } = useLocalSearchParams<{ meal?: string; returnTo?: string }>();
    return <MealDetailScreen mealId={meal} returnTo={returnTo} />;
}
