import { lazyScreen } from '../../src/shell/lazy-screen.tsx';

/** `/corporate` — the programmes this account buys through, and what is outstanding on each. */
const CorporateDashboardScreen = lazyScreen(
    'corporate-dashboard-loading',
    async () =>
        (await import('../../src/features/business/screens/index.ts')).CorporateDashboardScreen,
);

export default function CorporateIndex() {
    return <CorporateDashboardScreen />;
}
