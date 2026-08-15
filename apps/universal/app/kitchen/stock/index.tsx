import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

const StockScreen = lazyScreen(
    'kitchen-stock-loading',
    async () => (await import('../../../src/features/kitchen-admin/screens/index.ts')).StockScreen,
);

export default function KitchenStock() {
    return <StockScreen />;
}
