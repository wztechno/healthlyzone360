import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/production-desk/batches` — the register: what is finished, and what is still in date. */
const ProductionBatchesScreen = lazyScreen(
    'kitchen-production-batches-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts'))
            .ProductionBatchesScreen,
);

export default function KitchenProductionBatches() {
    return <ProductionBatchesScreen />;
}
