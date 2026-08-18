import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/supply-orders/new` — the builder.
 *
 * A static segment now, and one that will still be static when `[order].tsx` lands beside it in a
 * later slice: Expo Router prefers the static match, so `new` is never read as an order identifier.
 * It is a separate screen from the landing page rather than a mode of it, because preparing an order
 * is a task somebody works through, and a task that shares a URL with a dashboard cannot be linked
 * to, refreshed or abandoned cleanly.
 */
const SupplyOrderBuilderScreen = lazyScreen(
    'kitchen-supply-order-builder-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts'))
            .SupplyOrderBuilderScreen,
);

export default function NewKitchenSupplyOrder() {
    return <SupplyOrderBuilderScreen />;
}
