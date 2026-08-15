import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/products/{product}` — the product editor.
 *
 * `new` is a value of the same parameter rather than a sibling route file, exactly as the ingredient
 * and recipe editors do it: creating and editing share the form, the validation and the unsaved
 * guard, and two route files would be two places to keep that in step. The identifier is validated
 * in the screen, so a hand-typed link produces the designed not-found state rather than a repository
 * failure.
 */
const ProductEditScreen = lazyScreen(
    'kitchen-product-editor-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).ProductEditScreen,
);

export default function KitchenProductEditor() {
    const { product } = useLocalSearchParams<{ product?: string }>();
    return <ProductEditScreen product={product} />;
}
