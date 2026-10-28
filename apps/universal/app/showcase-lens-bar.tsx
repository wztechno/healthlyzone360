import { Redirect } from 'expo-router';

import { appConfig } from '../src/config.ts';
import { AreaShell } from '../src/shell/area-shell.tsx';
import { lazyScreen } from '../src/shell/lazy-screen.tsx';

/**
 * `/showcase-lens-bar` — the Lens bar on a page of its own, apart from `/showcase`, so the
 * redesign part can be judged in isolation. Development builds only, like the `/showcase` alias;
 * production sends the reader home.
 */
const LensBarShowcaseScreen = lazyScreen(
    'lens-bar-showcase-loading',
    async () => (await import('../src/screens/lens-bar-showcase-screen.tsx')).LensBarShowcaseScreen,
);

export default function LensBarShowcase() {
    if (!appConfig.isDevelopment) return <Redirect href="/" />;

    return (
        <AreaShell
            area="auth"
            variant="public"
            unguarded
            title="Lens bar"
            testID="lens-bar-showcase-shell"
        >
            <LensBarShowcaseScreen />
        </AreaShell>
    );
}
