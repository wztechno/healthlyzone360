import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/batch` — scale a recipe to a batch and read off what it needs. */
const BatchPlannerScreen = lazyScreen(
    'kitchen-batch-planner-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).BatchPlannerScreen,
);

export default function KitchenBatchPlanner() {
    return <BatchPlannerScreen />;
}
