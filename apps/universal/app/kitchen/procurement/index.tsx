import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

const ProcurementScreen = lazyScreen(
    'kitchen-procurement-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).ProcurementScreen,
);

export default function KitchenProcurement() {
    // `?view=`: the record whose page is open, so an editor sent from it comes back to it.
    const { view } = useLocalSearchParams<{ view?: string }>();
    return <ProcurementScreen view={view} />;
}
