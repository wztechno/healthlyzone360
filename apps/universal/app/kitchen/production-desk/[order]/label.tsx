import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../../src/shell/lazy-screen.tsx';

/** `/kitchen/production-desk/{order}/label` — the batch's GS1-128 label, printed from the web. */
const ProductionBatchLabelScreen = lazyScreen(
    'kitchen-production-label-loading',
    async () =>
        (await import('../../../../src/features/kitchen-admin/screens/index.ts'))
            .ProductionBatchLabelScreen,
);

export default function KitchenProductionBatchLabel() {
    const { order } = useLocalSearchParams<{ order?: string }>();
    return <ProductionBatchLabelScreen order={order} />;
}
