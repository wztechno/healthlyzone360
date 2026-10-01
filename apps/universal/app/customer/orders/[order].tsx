import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/customer/orders/{order}` — one of the signed-in customer's orders, tracked.
 *
 * The parameter is the order's **identifier**, not its printed number: `GET /me/orders/{order}`
 * refuses the number on purpose, and the history and the checkout confirmation both hold the
 * identifier. The guest equivalent is the public `/orders/{reference}`.
 */
const CustomerOrderScreen = lazyScreen(
    'customer-order-loading',
    async () => (await import('../../../src/features/orders/screens/index.ts')).CustomerOrderScreen,
);

export default function CustomerOrder() {
    const { order } = useLocalSearchParams<{ order?: string }>();
    return <CustomerOrderScreen orderId={order} />;
}
