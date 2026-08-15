import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

const QualityControlScreen = lazyScreen(
    'kitchen-qc-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).QualityControlScreen,
);

export default function KitchenQc() {
    return <QualityControlScreen />;
}
