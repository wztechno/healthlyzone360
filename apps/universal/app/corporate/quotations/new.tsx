import { useLocalSearchParams } from 'expo-router';

import { QuotationBuilderScreen } from '../../../src/features/business/screens/quotation-builder-screen.tsx';

/**
 * `/corporate/quotations/new?programme={programme}&item={item}` — compose a quotation.
 *
 * A static segment beside `index.tsx`, so `new` is never read as a quotation reference. `programme`
 * is required and validated in the screen; `item` is the line the catalogue sent us, seeded at its
 * minimum order quantity.
 */
export default function NewQuotation() {
    const { programme, item } = useLocalSearchParams<{ programme?: string; item?: string }>();
    return <QuotationBuilderScreen programmeId={programme} initialItemId={item} />;
}
