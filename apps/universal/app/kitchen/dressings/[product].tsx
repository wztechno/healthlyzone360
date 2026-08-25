import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/dressings/{product}` — the dressing editor; `new` opens the create form. */
const DressingEditScreen = lazyScreen(
    'kitchen-product-editor-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).DressingEditScreen,
);

export default function KitchenDressingEditor() {
    const { product } = useLocalSearchParams<{ product?: string }>();
    return <DressingEditScreen product={product} />;
}
