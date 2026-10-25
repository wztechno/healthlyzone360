import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

const QualityControlScreen = lazyScreen(
    'kitchen-qc-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).QualityControlScreen,
);

export default function KitchenQc() {
    // `?view=`: the record whose page is open, so an editor sent from it comes back to it.
    const { view } = useLocalSearchParams<{ view?: string }>();
    return <QualityControlScreen view={view} />;
}
