import { PlannerIndexScreen } from '../../../src/features/planner/screens/planner-index-screen.tsx';

/**
 * `/customer/planner` — resolves the plan and redirects to its week.
 *
 * The planner proper is addressed by week so that a week is linkable and reloadable; this route
 * exists so the navigation has one stable destination that does not need to know which Monday the
 * person is on.
 */
export default function PlannerIndexRoute() {
    return <PlannerIndexScreen />;
}
