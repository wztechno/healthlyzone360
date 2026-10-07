import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/customer/orders/{order}` — one order: status, lines, total and where it is going. */
const MyOrderDetailScreen = lazyScreen(
    'my-order-loading',
    async () =>
        (await import('../../../src/features/commerce/screens/index.ts')).MyOrderDetailScreen,
);

export default function CustomerOrder() {
    const { order } = useLocalSearchParams<{ order?: string }>();
    return <MyOrderDetailScreen orderId={order} />;
}
