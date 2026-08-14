import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

const QuotationsScreen = lazyScreen(
    'kitchen-quotations-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).QuotationsScreen,
);

export default function KitchenQuotations() {
    return <QuotationsScreen />;
}
