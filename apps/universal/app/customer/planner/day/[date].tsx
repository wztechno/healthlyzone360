import { useLocalSearchParams } from 'expo-router';

import { PlannerDayScreen } from '../../../../src/features/planner/screens/planner-day-screen.tsx';

/**
 * `/customer/planner/day/{date}` — one day of the plan.
 *
 * `date` is a `YYYY-MM-DD` date, validated in the screen so a hand-typed link produces a designed
 * not-found state rather than a repository failure.
 */
export default function PlannerDayRoute() {
    const { date } = useLocalSearchParams<{ date?: string }>();
    return <PlannerDayScreen date={date} />;
}
