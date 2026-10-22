import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/customers` — the kitchen's customer book, for reference. */
const CustomersScreen = lazyScreen(
    'kitchen-customers-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).CustomersScreen,
);

export default function KitchenCustomers() {
    return <CustomersScreen />;
}
