import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/stock/print` — the stock list as the reader left it, as a page. */
const ListPrintScreen = lazyScreen(
    'kitchen-list-print-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).ListPrintScreen,
);

export default function KitchenStockPrint() {
    return <ListPrintScreen resource="stock" />;
}
