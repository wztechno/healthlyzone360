import { lazyScreen } from '../../../../src/shell/lazy-screen.tsx';

/** `/kitchen/order-desk/calendar` — the week ahead on three books, never added together. */
const OrderDeskCalendarScreen = lazyScreen(
    'kitchen-order-desk-calendar-loading',
    async () =>
        (await import('../../../../src/features/kitchen-admin/screens/index.ts'))
            .OrderDeskCalendarScreen,
);

export default function KitchenOrderDeskCalendar() {
    return <OrderDeskCalendarScreen />;
}
