import { lazyScreen } from '../../../../src/shell/lazy-screen.tsx';

/** `/kitchen/order-desk/requirements` — what this branch must buy for the days ahead. */
const OrderDeskRequirementsScreen = lazyScreen(
    'kitchen-order-desk-requirements-loading',
    async () =>
        (await import('../../../../src/features/kitchen-admin/screens/index.ts'))
            .OrderDeskRequirementsScreen,
);

export default function KitchenOrderDeskRequirements() {
    return <OrderDeskRequirementsScreen />;
}
