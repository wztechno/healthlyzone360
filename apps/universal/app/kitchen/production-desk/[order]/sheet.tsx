import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../../src/shell/lazy-screen.tsx';

/** `/kitchen/production-desk/{order}/sheet` — the sheet confirm snapshotted, which never moves. */
const ProductionBatchSheetScreen = lazyScreen(
    'kitchen-production-batch-sheet-loading',
    async () =>
        (await import('../../../../src/features/kitchen-admin/screens/index.ts'))
            .ProductionBatchSheetScreen,
);

export default function KitchenProductionBatchSheet() {
    const { order } = useLocalSearchParams<{ order?: string }>();
    return <ProductionBatchSheetScreen order={order} />;
}
