import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/orders` — every order on one page: Today, Calendar and All orders. Its state is in the
 * address (`orders-url.ts`); `?view=<id>` alone, the old order book's link, opens All orders with
 * that order.
 */
const OrdersScreen = lazyScreen(
    'kitchen-orders-loading',
    async () => (await import('../../../src/features/kitchen-admin/screens/index.ts')).OrdersScreen,
);

export default function KitchenOrders() {
    return <OrdersScreen />;
}
