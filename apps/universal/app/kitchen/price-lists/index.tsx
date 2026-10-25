import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/price-lists` — what this kitchen charges, and how much of it is actually decided. */
const PriceListsScreen = lazyScreen(
    'kitchen-price-lists-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).PriceListsScreen,
);

export default function KitchenPriceLists() {
    // `?view=`: the record whose page is open, so an editor sent from it comes back to it.
    const { view } = useLocalSearchParams<{ view?: string }>();
    return <PriceListsScreen view={view} />;
}
