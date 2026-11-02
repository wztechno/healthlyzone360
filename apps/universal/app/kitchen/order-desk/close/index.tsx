import { lazyScreen } from '../../../../src/shell/lazy-screen.tsx';

/** `/kitchen/order-desk/close` — the till count at the end of a shift. */
const OrderDeskCloseScreen = lazyScreen(
    'kitchen-order-desk-close-loading',
    async () =>
        (await import('../../../../src/features/kitchen-admin/screens/index.ts'))
            .OrderDeskCloseScreen,
);

export default function KitchenOrderDeskClose() {
    return <OrderDeskCloseScreen />;
}
