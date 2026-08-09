import { lazyScreen } from '../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/cost-report` — the monthly cost report (INV1.4): spend and COGS beside selling revenue,
 * with margin, the meal-versus-product split and a data-quality flag.
 *
 * Behind `inventory.view_costs_organisation` — the screen's own `<Gate>` refuses a reader without it.
 */
const CostReportScreen = lazyScreen(
    'kitchen-cost-report-loading',
    async () => (await import('../../src/features/kitchen-admin/screens/index.ts')).CostReportScreen,
);

export default function KitchenCostReport() {
    return <CostReportScreen />;
}
