import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/corporate/quotations` — every quotation this account has raised, priced or not. */
const QuotationsScreen = lazyScreen(
    'corporate-quotations-loading',
    async () => (await import('../../../src/features/business/screens/index.ts')).QuotationsScreen,
);

export default function CorporateQuotations() {
    return <QuotationsScreen />;
}
