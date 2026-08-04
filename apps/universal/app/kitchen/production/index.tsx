import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

const ProductionScreen = lazyScreen(
    'kitchen-production-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).ProductionScreen,
);

export default function KitchenProduction() {
    return <ProductionScreen />;
}
