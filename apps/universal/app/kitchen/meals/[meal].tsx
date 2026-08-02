import { useLocalSearchParams } from 'expo-router';

import { MealEditScreen } from '../../../src/features/kitchen-admin/screens/meal-edit-screen.tsx';

/**
 * `/kitchen/meals/{meal}` — the meal editor, and the publication gate with it.
 *
 * `new` is a value of the same parameter, for the reason every other editor in this workspace gives.
 */
export default function KitchenMealEditor() {
    const { meal } = useLocalSearchParams<{ meal?: string }>();
    return <MealEditScreen meal={meal} />;
}
