import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/payables` — what is owed for deliveries, behind the cost code. */
const PayablesScreen = lazyScreen(
    'kitchen-payables-loading',
    async () => (await import('../../../src/features/kitchen-admin/screens/index.ts')).PayablesScreen,
);

export default function KitchenPayables() {
    return <PayablesScreen />;
}
