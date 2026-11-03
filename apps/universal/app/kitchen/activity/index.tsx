import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/activity` — who moved the stock, what the waste cost, and the audit trail. */
const ActivityScreen = lazyScreen(
    'kitchen-activity-loading',
    async () => (await import('../../../src/features/kitchen-admin/screens/index.ts')).ActivityScreen,
);

export default function KitchenActivity() {
    return <ActivityScreen />;
}
