import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/recipes/sheets?recipes=…` — up to twenty technical sheets, one per page.
 *
 * A **static** segment beside `[recipe].tsx`, which Expo Router prefers over the dynamic match.
 * The recipes are a query parameter for the reason `supply-orders/print.tsx` gives: a batch is a set.
 */
const RecipeSheetsPrintScreen = lazyScreen(
    'kitchen-recipe-sheets-print-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts'))
            .RecipeSheetsPrintScreen,
);

export default function KitchenRecipeSheetsPrint() {
    const { recipes } = useLocalSearchParams<{ recipes?: string }>();
    return <RecipeSheetsPrintScreen recipes={recipes} />;
}
