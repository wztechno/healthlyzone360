import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/customers/{customer}` — one customer's contacts, addresses and company record.
 *
 * The parameter is validated by the server, so a hand-typed link lands on the not-found state.
 */
const CustomerDetailScreen = lazyScreen(
    'kitchen-customer-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).CustomerDetailScreen,
);

export default function KitchenCustomerDetail() {
    const { customer } = useLocalSearchParams<{ customer?: string }>();
    return <CustomerDetailScreen customer={customer} />;
}
