import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/price-lists/{priceList}` — the price-list editor.
 *
 * **No `new`**, unlike every other editor in this workspace: a list is created from a dialog on
 * `/kitchen/price-lists` (or `/kitchen/wholesale`), which then opens it here by its identifier. The
 * identifier is validated in the screen, so a hand-typed link produces the designed not-found state
 * rather than a repository failure.
 */
const PriceListEditScreen = lazyScreen(
    'kitchen-price-list-editor-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).PriceListEditScreen,
);

export default function KitchenPriceListEditor() {
    // `?returnTo=`: the page that sent the reader here — the review queue, on this record.
    const { priceList, returnTo } = useLocalSearchParams<{
        priceList?: string;
        returnTo?: string;
    }>();
    return <PriceListEditScreen priceList={priceList} returnTo={returnTo} />;
}
