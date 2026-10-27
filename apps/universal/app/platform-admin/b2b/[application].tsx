import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/platform-admin/b2b/{application}` — one application, from claim to provisioning. */
const PlatformB2bApplicationScreen = lazyScreen(
    'platform-admin-b2b-application-loading',
    async () =>
        (await import('../../../src/features/platform-admin/screens/index.ts'))
            .PlatformB2bApplicationScreen,
);

export default function PlatformAdminB2bApplication() {
    return <PlatformB2bApplicationScreen />;
}
