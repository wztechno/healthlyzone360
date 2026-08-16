import { lazyScreen } from '../../../../src/shell/lazy-screen.tsx';

/** `/kitchen/order-desk/sale` — ringing up a counter, pickup or telephone sale. */
const OrderDeskSaleScreen = lazyScreen(
    'kitchen-order-desk-sale-loading',
    async () =>
        (await import('../../../../src/features/kitchen-admin/screens/index.ts'))
            .OrderDeskSaleScreen,
);

export default function KitchenOrderDeskSale() {
    return <OrderDeskSaleScreen />;
}
