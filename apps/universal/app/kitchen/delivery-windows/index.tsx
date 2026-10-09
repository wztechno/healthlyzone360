import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/delivery-windows` — the kitchen's delivery slots, which each zone then chooses among. */
const DeliveryWindowsScreen = lazyScreen(
    'kitchen-windows-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts'))
            .DeliveryWindowsScreen,
);

export default function KitchenDeliveryWindows() {
    return <DeliveryWindowsScreen />;
}
