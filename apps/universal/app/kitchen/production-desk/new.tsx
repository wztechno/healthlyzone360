import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/production-desk/new` — open a draft batch.
 *
 * A static sibling of `[order].tsx`, and Expo Router prefers the static match, so "new" is never
 * read as a batch identifier.
 */
const ProductionBatchNewScreen = lazyScreen(
    'kitchen-production-batch-new-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts'))
            .ProductionBatchNewScreen,
);

export default function KitchenProductionBatchNew() {
    return <ProductionBatchNewScreen />;
}
