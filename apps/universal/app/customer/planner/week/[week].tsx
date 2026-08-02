import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../../src/shell/lazy-screen.tsx';

/**
 * `/customer/planner/week/{week}` — the weekly planner.
 *
 * `week` is a `YYYY-MM-DD` date. It is read here and validated in the screen: a mid-week date is
 * normalised to its Monday, and anything that is not a real date produces the designed not-found
 * state rather than a repository failure.
 */
const PlannerWeekScreen = lazyScreen(
    'planner-week-loading',
    async () =>
        (await import('../../../../src/features/planner/screens/index.ts')).PlannerWeekScreen,
);

export default function PlannerWeekRoute() {
    const { week } = useLocalSearchParams<{ week?: string }>();
    return <PlannerWeekScreen week={week} />;
}
