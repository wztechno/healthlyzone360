import { KitchenHomeScreen } from '../../src/features/kitchen-admin/screens/kitchen-home-screen.tsx';

/**
 * `/kitchen` — the kitchen workspace hub (phase K1).
 *
 * The card grid is driven by `features/kitchen-admin/entity-registry.ts`, so the slices that follow
 * add a registry entry rather than editing this route.
 */
export default function KitchenIndex() {
    return <KitchenHomeScreen />;
}
