import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/recipes/print` — the recipe list as the reader left it, as a page.
 *
 * A **static** segment beside `[recipe].tsx`, which Expo Router prefers over the dynamic match, so
 * "print" is never read as a recipe identifier (the arrangement `supply-orders/print.tsx` uses).
 */
const ListPrintScreen = lazyScreen(
    'kitchen-list-print-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).ListPrintScreen,
);

export default function KitchenRecipesPrint() {
    return <ListPrintScreen resource="recipes" />;
}
