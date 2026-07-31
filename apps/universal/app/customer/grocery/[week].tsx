import { useLocalSearchParams } from 'expo-router';

import { GroceryListScreen } from '../../../src/features/planner/screens/grocery-list-screen.tsx';

/**
 * `/customer/grocery/{week}` — the shopping list derived from a week of the plan.
 *
 * `week` is the Monday, `YYYY-MM-DD`, matching `GET /api/v1/grocery-lists/{week}`. A mid-week date
 * is normalised to its Monday in the screen so a link from a day still resolves.
 */
export default function GroceryListRoute() {
    const { week } = useLocalSearchParams<{ week?: string }>();
    return <GroceryListScreen week={week} />;
}
