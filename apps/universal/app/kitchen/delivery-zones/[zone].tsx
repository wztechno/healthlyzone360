import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/delivery-zones/{zone}` — the zone editor.
 *
 * `new` opens the create form, exactly as the ingredient, recipe, product, meal and plan editors do:
 * `KitchenAdminRepository` publishes `createZone`, so the route parameter genuinely has a
 * non-identifier value. Anything else is validated in the screen, so a hand-typed link produces the
 * designed not-found state rather than a repository failure.
 */
const DeliveryZoneEditScreen = lazyScreen(
    'kitchen-zone-editor-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts'))
            .DeliveryZoneEditScreen,
);

export default function KitchenDeliveryZoneEditor() {
    const { zone } = useLocalSearchParams<{ zone?: string }>();
    return <DeliveryZoneEditScreen zone={zone} />;
}
