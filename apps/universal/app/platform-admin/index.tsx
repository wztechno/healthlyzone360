import { lazyScreen } from '../../src/shell/lazy-screen.tsx';

/** `/platform-admin` — the kitchen tenant list, and the console's front door. */
const PlatformKitchensScreen = lazyScreen(
    'platform-admin-kitchens-loading',
    async () =>
        (await import('../../src/features/platform-admin/screens/index.ts')).PlatformKitchensScreen,
);

export default function PlatformAdminIndex() {
    return <PlatformKitchensScreen />;
}
