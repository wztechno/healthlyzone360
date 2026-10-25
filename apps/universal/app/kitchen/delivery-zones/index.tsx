import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/delivery-zones` — where this kitchen delivers, for how much, and how quickly. */
const DeliveryZonesScreen = lazyScreen(
    'kitchen-zones-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).DeliveryZonesScreen,
);

export default function KitchenDeliveryZones() {
    // `?view=`: the record whose page is open, so an editor sent from it comes back to it.
    const { view } = useLocalSearchParams<{ view?: string }>();
    return <DeliveryZonesScreen view={view} />;
}
