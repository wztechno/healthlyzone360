import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/production-desk` — the batches this kitchen still has to move, with their edges. */
const ProductionDeskScreen = lazyScreen(
    'kitchen-production-desk-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).ProductionDeskScreen,
);

export default function KitchenProductionDesk() {
    return <ProductionDeskScreen />;
}
