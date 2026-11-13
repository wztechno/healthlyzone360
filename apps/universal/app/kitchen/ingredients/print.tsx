import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/ingredients/print` — the ingredient list as the reader left it, as a page.
 *
 * A **static** segment beside `[ingredient]/`, which Expo Router prefers over the dynamic match, so
 * "print" is never read as an ingredient identifier (the arrangement `supply-orders/print.tsx` uses).
 */
const ListPrintScreen = lazyScreen(
    'kitchen-list-print-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).ListPrintScreen,
);

export default function KitchenIngredientsPrint() {
    return <ListPrintScreen resource="ingredients" />;
}
