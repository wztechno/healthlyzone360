import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/corporate/quotations/new?programme={programme}&items={a,b}&qty={n}` — compose a quotation.
 *
 * A static segment beside `index.tsx`, so `new` is never read as a quotation reference. `programme`
 * names the catalogue (the first programme when absent); `items` (or the older `item`) are the lines
 * the catalogue sent us, seeded at `qty` packs — one when absent.
 */
const QuotationBuilderScreen = lazyScreen(
    'corporate-quotation-builder-loading',
    async () =>
        (await import('../../../src/features/business/screens/index.ts')).QuotationBuilderScreen,
);

export default function NewQuotation() {
    const { programme, item, items, qty } = useLocalSearchParams<{
        programme?: string;
        item?: string;
        items?: string;
        qty?: string;
    }>();
    const initialItemIds = [
        ...(items ?? '').split(','),
        ...(item === undefined ? [] : [item]),
    ].filter((id) => id !== '');
    const quantity = qty === undefined ? Number.NaN : Number.parseInt(qty, 10);
    return (
        <QuotationBuilderScreen
            programmeId={programme}
            initialItemIds={initialItemIds}
            initialQuantity={Number.isInteger(quantity) && quantity > 0 ? quantity : undefined}
        />
    );
}
