import { Redirect } from 'expo-router';

import { appConfig } from '../src/config.ts';
import { AreaShell } from '../src/shell/area-shell.tsx';
import { lazyScreen } from '../src/shell/lazy-screen.tsx';

/**
 * `/showcase-trail` — the kitchen breadcrumb on a page of its own, apart from `/showcase`.
 * Development builds only; production sends the reader home.
 */
const TrailShowcaseScreen = lazyScreen(
    'trail-showcase-loading',
    async () => (await import('../src/screens/trail-showcase-screen.tsx')).TrailShowcaseScreen,
);

export default function TrailShowcase() {
    return appConfig.isDevelopment ? (
        <AreaShell
            area="auth"
            variant="public"
            unguarded
            title="Kitchen breadcrumb"
            testID="trail-showcase-shell"
        >
            <TrailShowcaseScreen />
        </AreaShell>
    ) : (
        <Redirect href="/" />
    );
}
