import { useLocalSearchParams } from 'expo-router';

import { CatalogueItemScreen } from '../../../src/features/business/screens/catalogue-item-screen.tsx';

/**
 * `/corporate/items/{item}` — one negotiated line and its volume tiers.
 *
 * A catalogue line is identified by a readable code (`catalogue-staff-lunch-box`) rather than a
 * UUID, because it is negotiated paperwork a buyer quotes back on a purchase order.
 */
export default function CorporateCatalogueItem() {
    const { itemId } = useLocalSearchParams<{ itemId?: string }>();
    return <CatalogueItemScreen itemId={itemId} />;
}
