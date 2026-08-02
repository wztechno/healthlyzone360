import { lazyScreen } from '../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen` — the kitchen workspace hub (phase K1).
 *
 * The card grid is driven by `features/kitchen-admin/entity-registry.ts`, so the slices that follow
 * add a registry entry rather than editing this route.
 *
 * Split like every other route in this area — `src/shell/lazy-screen.tsx` says why the whole kitchen
 * workspace sits behind dynamic imports.
 */
const KitchenHomeScreen = lazyScreen(
    'kitchen-home-loading',
    async () =>
        (await import('../../src/features/kitchen-admin/screens/index.ts')).KitchenHomeScreen,
);

export default function KitchenIndex() {
    return <KitchenHomeScreen />;
}
