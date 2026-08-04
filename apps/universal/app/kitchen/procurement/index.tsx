import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

const ProcurementScreen = lazyScreen(
    'kitchen-procurement-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).ProcurementScreen,
);

export default function KitchenProcurement() {
    return <ProcurementScreen />;
}
