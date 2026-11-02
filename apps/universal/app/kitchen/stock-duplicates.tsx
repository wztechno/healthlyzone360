import { lazyScreen } from '../../src/shell/lazy-screen.tsx';

/** `/kitchen/stock-duplicates` — the stock rows sharing a name that need a person. */
export default lazyScreen(
    'kitchen-stock-duplicates-loading',
    async () =>
        (await import('../../src/features/kitchen-admin/screens/index.ts')).StockDuplicatesScreen,
);
