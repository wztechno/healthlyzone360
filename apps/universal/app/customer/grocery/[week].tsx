import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/customer/grocery/{week}` — the shopping list derived from a week of the plan.
 *
 * `week` is the Monday, `YYYY-MM-DD`, matching `GET /api/v1/grocery-lists/{week}`. A mid-week date
 * is normalised to its Monday in the screen so a link from a day still resolves.
 */
const GroceryListScreen = lazyScreen(
    'grocery-list-loading',
    async () => (await import('../../../src/features/planner/screens/index.ts')).GroceryListScreen,
);

export default function GroceryListRoute() {
    const { week } = useLocalSearchParams<{ week?: string }>();
    return <GroceryListScreen week={week} />;
}
