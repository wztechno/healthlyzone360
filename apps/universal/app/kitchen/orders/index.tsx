import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

const OrdersScreen = lazyScreen(
    'kitchen-orders-loading',
    async () => (await import('../../../src/features/kitchen-admin/screens/index.ts')).OrdersScreen,
);

export default function KitchenOrders() {
    return <OrdersScreen />;
}
