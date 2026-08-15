import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/meals/{meal}` — the meal editor, and the publication gate with it.
 *
 * `new` is a value of the same parameter, for the reason every other editor in this workspace gives.
 */
const MealEditScreen = lazyScreen(
    'kitchen-meal-editor-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).MealEditScreen,
);

export default function KitchenMealEditor() {
    const { meal } = useLocalSearchParams<{ meal?: string }>();
    return <MealEditScreen meal={meal} />;
}
