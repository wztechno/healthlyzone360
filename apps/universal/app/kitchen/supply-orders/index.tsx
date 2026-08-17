import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/supply-orders` — what this branch is short of, and the way into ordering it. */
const SupplyOrdersScreen = lazyScreen(
    'kitchen-supply-orders-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).SupplyOrdersScreen,
);

export default function KitchenSupplyOrders() {
    return <SupplyOrdersScreen />;
}
