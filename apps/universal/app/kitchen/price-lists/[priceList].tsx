import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/price-lists/{priceList}` — the price-list editor.
 *
 * **No `new`**, unlike every other editor in this workspace. `KitchenAdminRepository` publishes no
 * `createPriceList`, so there is no create form for this parameter to select and a route file that
 * accepted the value would offer a screen with no request behind it. The identifier is validated in
 * the screen, so a hand-typed link produces the designed not-found state rather than a repository
 * failure.
 */
const PriceListEditScreen = lazyScreen(
    'kitchen-price-list-editor-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).PriceListEditScreen,
);

export default function KitchenPriceListEditor() {
    const { priceList } = useLocalSearchParams<{ priceList?: string }>();
    return <PriceListEditScreen priceList={priceList} />;
}
