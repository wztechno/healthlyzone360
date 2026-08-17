import { lazyScreen } from '../../../../src/shell/lazy-screen.tsx';

/** `/kitchen/order-desk/cash-report` — one day's takings by agent, method and currency. */
const OrderDeskCashReportScreen = lazyScreen(
    'kitchen-order-desk-cash-report-loading',
    async () =>
        (await import('../../../../src/features/kitchen-admin/screens/index.ts'))
            .OrderDeskCashReportScreen,
);

export default function KitchenOrderDeskCashReport() {
    return <OrderDeskCashReportScreen />;
}
