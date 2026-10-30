import { Redirect } from 'expo-router';

import { appConfig } from '../src/config.ts';
import { AreaShell } from '../src/shell/area-shell.tsx';
import { lazyScreen } from '../src/shell/lazy-screen.tsx';

/**
 * `/showcase-kept-work` — the leave dialog and the kept work's card and pill on a page of their
 * own, apart from `/showcase`. Development builds only; production sends the reader home.
 */
const KeptWorkShowcaseScreen = lazyScreen(
    'kept-work-showcase-loading',
    async () =>
        (await import('../src/screens/kept-work-showcase-screen.tsx')).KeptWorkShowcaseScreen,
);

export default function KeptWorkShowcase() {
    if (!appConfig.isDevelopment) return <Redirect href="/" />;

    return (
        <AreaShell
            area="auth"
            variant="public"
            unguarded
            title="Kept work"
            testID="kept-work-showcase-shell"
        >
            <KeptWorkShowcaseScreen />
        </AreaShell>
    );
}
