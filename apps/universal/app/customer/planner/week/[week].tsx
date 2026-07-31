import { useLocalSearchParams } from 'expo-router';

import { PlannerWeekScreen } from '../../../../src/features/planner/screens/planner-week-screen.tsx';

/**
 * `/customer/planner/week/{week}` — the weekly planner.
 *
 * `week` is a `YYYY-MM-DD` date. It is read here and validated in the screen: a mid-week date is
 * normalised to its Monday, and anything that is not a real date produces the designed not-found
 * state rather than a repository failure.
 */
export default function PlannerWeekRoute() {
    const { week } = useLocalSearchParams<{ week?: string }>();
    return <PlannerWeekScreen week={week} />;
}
