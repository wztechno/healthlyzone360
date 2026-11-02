import { lazyScreen } from '../../../../src/shell/lazy-screen.tsx';

/** `/kitchen/order-desk/settlement` — cash handed in by drivers and couriers. */
const OrderDeskSettlementScreen = lazyScreen(
    'kitchen-order-desk-settlement-loading',
    async () =>
        (await import('../../../../src/features/kitchen-admin/screens/index.ts'))
            .OrderDeskSettlementScreen,
);

export default function KitchenOrderDeskSettlement() {
    return <OrderDeskSettlementScreen />;
}
