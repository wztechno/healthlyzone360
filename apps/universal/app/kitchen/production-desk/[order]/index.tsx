import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/production-desk/{order}` — one batch and every edge it has left.
 *
 * The parameter is validated in the screen, so a hand-typed link produces the designed not-found
 * state rather than a repository failure.
 */
const ProductionBatchScreen = lazyScreen(
    'kitchen-production-batch-loading',
    async () =>
        (await import('../../../../src/features/kitchen-admin/screens/index.ts'))
            .ProductionBatchScreen,
);

export default function KitchenProductionBatch() {
    const { order } = useLocalSearchParams<{ order?: string }>();
    return <ProductionBatchScreen order={order} />;
}
