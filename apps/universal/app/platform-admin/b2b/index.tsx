import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/platform-admin/b2b` — the B2B onboarding queue. */
const PlatformB2bApplicationsScreen = lazyScreen(
    'platform-admin-b2b-loading',
    async () =>
        (await import('../../../src/features/platform-admin/screens/index.ts'))
            .PlatformB2bApplicationsScreen,
);

export default function PlatformAdminB2bIndex() {
    return <PlatformB2bApplicationsScreen />;
}
