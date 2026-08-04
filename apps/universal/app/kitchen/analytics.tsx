import { lazyScreen } from '../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/analytics` — interactive kitchen ops analytics dashboard (sample data).
 *
 * Reachable by anyone holding `catalogue.view_organisation`. Figures are deterministic samples so
 * charts stay alive without inventing API truth.
 */
const AnalyticsScreen = lazyScreen(
    'kitchen-analytics-loading',
    async () => (await import('../../src/features/kitchen-admin/screens/index.ts')).AnalyticsScreen,
);

export default function KitchenAnalytics() {
    return <AnalyticsScreen />;
}
