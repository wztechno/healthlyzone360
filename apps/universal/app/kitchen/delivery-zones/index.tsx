import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/delivery-zones` — where this kitchen delivers, for how much, and how quickly. */
const DeliveryZonesScreen = lazyScreen(
    'kitchen-zones-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).DeliveryZonesScreen,
);

export default function KitchenDeliveryZones() {
    return <DeliveryZonesScreen />;
}
