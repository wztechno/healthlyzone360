import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/corporate/items/{item}` — one negotiated line and its volume tiers.
 *
 * A catalogue line is identified by a readable code (`catalogue-staff-lunch-box`) rather than a
 * UUID, because it is negotiated paperwork a buyer quotes back on a purchase order.
 */
const CatalogueItemScreen = lazyScreen(
    'corporate-item-loading',
    async () =>
        (await import('../../../src/features/business/screens/index.ts')).CatalogueItemScreen,
);

export default function CorporateCatalogueItem() {
    const { itemId } = useLocalSearchParams<{ itemId?: string }>();
    return <CatalogueItemScreen itemId={itemId} />;
}
