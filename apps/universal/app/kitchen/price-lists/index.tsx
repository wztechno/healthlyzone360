import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/price-lists` — what this kitchen charges, and how much of it is actually decided. */
const PriceListsScreen = lazyScreen(
    'kitchen-price-lists-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).PriceListsScreen,
);

export default function KitchenPriceLists() {
    return <PriceListsScreen />;
}
