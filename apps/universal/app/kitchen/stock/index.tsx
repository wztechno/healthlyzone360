import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

const StockScreen = lazyScreen(
    'kitchen-stock-loading',
    async () => (await import('../../../src/features/kitchen-admin/screens/index.ts')).StockScreen,
);

export default function KitchenStock() {
    // `?view=`: the record whose page is open, so an editor sent from it comes back to it.
    const { view } = useLocalSearchParams<{ view?: string }>();
    return <StockScreen view={view} />;
}
