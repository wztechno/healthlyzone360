import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/sauces/{product}` — the sauce editor; `new` opens the create form. */
const SauceEditScreen = lazyScreen(
    'kitchen-product-editor-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).SauceEditScreen,
);

export default function KitchenSauceEditor() {
    const { product } = useLocalSearchParams<{ product?: string }>();
    return <SauceEditScreen product={product} />;
}
