import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/products` — the goods this kitchen sells, with their packs and channels. */
const ProductsScreen = lazyScreen(
    'kitchen-products-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).ProductsScreen,
);

export default function KitchenProducts() {
    return <ProductsScreen />;
}
