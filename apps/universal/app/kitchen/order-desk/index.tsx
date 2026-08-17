import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/order-desk` — the open order book in the order it is due, with its window filters. */
const OrderDeskScreen = lazyScreen(
    'kitchen-order-desk-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).OrderDeskScreen,
);

export default function KitchenOrderDesk() {
    return <OrderDeskScreen />;
}
