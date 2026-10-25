import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/products` — the goods this kitchen sells, with their packs and channels. */
const ProductsScreen = lazyScreen(
    'kitchen-products-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).ProductsScreen,
);

export default function KitchenProducts() {
    // `?view=`: the record whose page is open, so an editor sent from it comes back to it.
    const { view } = useLocalSearchParams<{ view?: string }>();
    return <ProductsScreen view={view} />;
}
