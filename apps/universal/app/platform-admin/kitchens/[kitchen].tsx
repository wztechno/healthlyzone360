import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/platform-admin/kitchens/{kitchen}` — one tenant: its branches, its owners, its lifecycle. */
const PlatformKitchenDetailScreen = lazyScreen(
    'platform-admin-kitchen-loading',
    async () =>
        (await import('../../../src/features/platform-admin/screens/index.ts'))
            .PlatformKitchenDetailScreen,
);

export default function PlatformAdminKitchen() {
    return <PlatformKitchenDetailScreen />;
}
