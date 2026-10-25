import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/suppliers` — who this kitchen buys from, and who to call there. */
const SuppliersScreen = lazyScreen(
    'kitchen-suppliers-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).SuppliersScreen,
);

export default function KitchenSuppliers() {
    // `?view=`: the record whose page is open, so an editor sent from it comes back to it.
    const { view } = useLocalSearchParams<{ view?: string }>();
    return <SuppliersScreen view={view} />;
}
