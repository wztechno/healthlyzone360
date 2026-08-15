import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/corporate/quotations/new?programme={programme}&item={item}` — compose a quotation.
 *
 * A static segment beside `index.tsx`, so `new` is never read as a quotation reference. `programme`
 * is required and validated in the screen; `item` is the line the catalogue sent us, seeded at its
 * minimum order quantity.
 */
const QuotationBuilderScreen = lazyScreen(
    'corporate-quotation-builder-loading',
    async () =>
        (await import('../../../src/features/business/screens/index.ts')).QuotationBuilderScreen,
);

export default function NewQuotation() {
    const { programme, item } = useLocalSearchParams<{ programme?: string; item?: string }>();
    return <QuotationBuilderScreen programmeId={programme} initialItemId={item} />;
}
