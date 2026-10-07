import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/customer/orders` — every one-off order this person has placed, newest first. */
const MyOrdersScreen = lazyScreen(
    'my-orders-loading',
    async () => (await import('../../../src/features/commerce/screens/index.ts')).MyOrdersScreen,
);

export default function CustomerOrders() {
    return <MyOrdersScreen />;
}
