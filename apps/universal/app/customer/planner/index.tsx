import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/customer/planner` — resolves the plan and redirects to its week.
 *
 * The planner proper is addressed by week so that a week is linkable and reloadable; this route
 * exists so the navigation has one stable destination that does not need to know which Monday the
 * person is on.
 */
const PlannerIndexScreen = lazyScreen(
    'planner-index-loading',
    async () => (await import('../../../src/features/planner/screens/index.ts')).PlannerIndexScreen,
);

export default function PlannerIndexRoute() {
    return <PlannerIndexScreen />;
}
