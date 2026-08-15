import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../../src/shell/lazy-screen.tsx';

/**
 * `/customer/planner/day/{date}` — one day of the plan.
 *
 * `date` is a `YYYY-MM-DD` date, validated in the screen so a hand-typed link produces a designed
 * not-found state rather than a repository failure.
 */
const PlannerDayScreen = lazyScreen(
    'planner-day-loading',
    async () =>
        (await import('../../../../src/features/planner/screens/index.ts')).PlannerDayScreen,
);

export default function PlannerDayRoute() {
    const { date } = useLocalSearchParams<{ date?: string }>();
    return <PlannerDayScreen date={date} />;
}
