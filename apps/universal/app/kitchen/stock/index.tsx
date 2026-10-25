import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

const StockScreen = lazyScreen(
    'kitchen-stock-loading',
    async () => (await import('../../../src/features/kitchen-admin/screens/index.ts')).StockScreen,
);

export default function KitchenStock() {
    // `?view=`: the record whose page is open, so an editor sent from it comes back to it.
    // `?ingredient=` / `?item=` with `?returnTo=`: a Stock gap sent the reader to move that shelf.
    const { view, ingredient, item, returnTo } = useLocalSearchParams<{
        view?: string;
        ingredient?: string;
        item?: string;
        returnTo?: string;
    }>();
    return <StockScreen view={view} ingredient={ingredient} item={item} returnTo={returnTo} />;
}
