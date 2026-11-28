import { Redirect } from 'expo-router';

import { appConfig } from '../src/config.ts';
import { AreaShell } from '../src/shell/area-shell.tsx';
import { lazyScreen } from '../src/shell/lazy-screen.tsx';

/**
 * `/showcase-admin-frame` — the staff areas' frame on a page of its own, apart from `/showcase`,
 * so the redesign part can be judged in isolation. Development builds only, like the `/showcase`
 * alias; production sends the reader home.
 */
const AdminFrameShowcaseScreen = lazyScreen(
    'admin-frame-showcase-loading',
    async () =>
        (await import('../src/screens/admin-frame-showcase-screen.tsx')).AdminFrameShowcaseScreen,
);

export default function AdminFrameShowcase() {
    if (!appConfig.isDevelopment) return <Redirect href="/" />;

    return (
        <AreaShell
            area="auth"
            variant="public"
            unguarded
            title="Admin frame"
            testID="admin-frame-showcase-shell"
        >
            <AdminFrameShowcaseScreen />
        </AreaShell>
    );
}
