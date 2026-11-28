import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/corporate/quotations?state={filter}` — every quotation this account has raised, priced or not.
 * `state` opens the list on one of its segments; the overview's "Awaiting your decision" card links
 * here with `state=quoted`. `open` opens one quotation's pop-up by its reference — the overview's
 * View.
 */
const QuotationsScreen = lazyScreen(
    'corporate-quotations-loading',
    async () => (await import('../../../src/features/business/screens/index.ts')).QuotationsScreen,
);

export default function CorporateQuotations() {
    const { state, open } = useLocalSearchParams<{ state?: string; open?: string }>();
    return <QuotationsScreen initialFilter={state} initialOpen={open} />;
}
