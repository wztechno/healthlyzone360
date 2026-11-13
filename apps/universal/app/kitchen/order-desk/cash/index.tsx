import { lazyScreen } from '../../../../src/shell/lazy-screen.tsx';

/** `/kitchen/order-desk/cash` — cash taken, hand-ins and the daily close, one tab each. */
const OrderDeskCashScreen = lazyScreen(
    'kitchen-order-desk-cash-loading',
    async () =>
        (await import('../../../../src/features/kitchen-admin/screens/index.ts'))
            .OrderDeskCashScreen,
);

export default function KitchenOrderDeskCash() {
    return <OrderDeskCashScreen />;
}
