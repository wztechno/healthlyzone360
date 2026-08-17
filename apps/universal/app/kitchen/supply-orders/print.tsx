import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/supply-orders/print?orders=…` — the printable purchase orders (SUP7, §7).
 *
 * A **static** segment beside `[order].tsx`, which Expo Router prefers over the dynamic match, so
 * "print" is never read as an order identifier — the same arrangement `new.tsx` already relies on.
 *
 * The orders are a query parameter rather than path segments because a batch is a *set*: one route
 * prints one order or fourteen, and `…/print/a/b/c` would need a catch-all segment to say the same
 * thing less legibly. The screen validates every identifier, so a hand-edited link lands on the
 * designed nothing-to-print state rather than on a repository failure.
 *
 * It sits under `supply-orders/` rather than in a family of its own: the shell resolves breadcrumbs
 * by route prefix, so the trail reads "Kitchen workspace › Supply orders" with the family crumb
 * linking back to the book — which is exactly where somebody wants to go after printing.
 */
const SupplyOrderPrintScreen = lazyScreen(
    'kitchen-supply-print-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts'))
            .SupplyOrderPrintScreen,
);

export default function KitchenSupplyOrderPrint() {
    const { orders } = useLocalSearchParams<{ orders?: string }>();
    return <SupplyOrderPrintScreen orders={orders} />;
}
