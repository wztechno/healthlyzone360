import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/corporate/items/{item}?programme={programme}` — one negotiated line, as a pop-up over its
 * programme's catalogue. `programme` names the catalogue behind it; without it (a code typed into the
 * overview's lookup) the first programme's catalogue is drawn.
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
    const { itemId, programme } = useLocalSearchParams<{ itemId?: string; programme?: string }>();
    return <CatalogueItemScreen itemId={itemId} programmeId={programme} />;
}
