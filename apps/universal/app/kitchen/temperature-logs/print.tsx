import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/temperature-logs/print` — the log as the reader left it, as a page. */
const ListPrintScreen = lazyScreen(
    'kitchen-list-print-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).ListPrintScreen,
);

export default function KitchenTemperatureLogsPrint() {
    return <ListPrintScreen resource="temperature-logs" />;
}
