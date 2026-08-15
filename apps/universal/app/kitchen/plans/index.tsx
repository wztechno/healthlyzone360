import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/plans` — the commercial plans this kitchen sells, and how much of each is decided. */
const PlansScreen = lazyScreen(
    'kitchen-plans-loading',
    async () => (await import('../../../src/features/kitchen-admin/screens/index.ts')).PlansScreen,
);

export default function KitchenPlans() {
    return <PlansScreen />;
}
