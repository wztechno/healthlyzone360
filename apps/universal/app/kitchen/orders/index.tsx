import { Redirect, useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

const OrdersScreen = lazyScreen(
    'kitchen-orders-loading',
    async () => (await import('../../../src/features/kitchen-admin/screens/index.ts')).OrdersScreen,
);

export default function KitchenOrders() {
    // `?view=`: the record whose page is open, so an editor sent from it comes back to it.
    // `?order=`: an alert's link, from the bell or an email. It opens that same record.
    const { view, order } = useLocalSearchParams<{ view?: string; order?: string }>();
    if (order !== undefined && order !== '') {
        return <Redirect href={`/kitchen/orders?view=${encodeURIComponent(order)}` as never} />;
    }
    return <OrdersScreen view={view} />;
}
