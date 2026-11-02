import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

const OrdersScreen = lazyScreen(
    'kitchen-orders-loading',
    async () => (await import('../../../src/features/kitchen-admin/screens/index.ts')).OrdersScreen,
);

export default function KitchenOrders() {
    // `?view=`: the record whose page is open, so an editor sent from it comes back to it.
    const { view } = useLocalSearchParams<{ view?: string }>();
    return <OrdersScreen view={view} />;
}
