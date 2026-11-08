import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/orders/ticket?order=…` — the kitchen ticket for one order, as `supply-orders/print.tsx`. */
const KitchenTicketPrintScreen = lazyScreen(
    'kitchen-ticket-print-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts'))
            .KitchenTicketPrintScreen,
);

export default function KitchenOrderTicket() {
    const { order } = useLocalSearchParams<{ order?: string }>();
    return <KitchenTicketPrintScreen order={order} />;
}
