import { Redirect } from 'expo-router';

import { appConfig } from '../src/config.ts';
import { AreaShell } from '../src/shell/area-shell.tsx';
import { lazyScreen } from '../src/shell/lazy-screen.tsx';

/**
 * `/showcase-setup-road` — the Setup page's road, on a page of its own.
 * Development builds only, like the `/showcase` alias; production sends the reader home.
 */
const SetupRoadShowcaseScreen = lazyScreen(
    'setup-road-showcase-loading',
    async () =>
        (await import('../src/screens/setup-road-showcase-screen.tsx')).SetupRoadShowcaseScreen,
);

export default function SetupRoadShowcase() {
    if (!appConfig.isDevelopment) return <Redirect href="/" />;

    return (
        <AreaShell
            area="auth"
            variant="public"
            unguarded
            title="Setup road"
            testID="setup-road-showcase-shell"
        >
            <SetupRoadShowcaseScreen />
        </AreaShell>
    );
}
