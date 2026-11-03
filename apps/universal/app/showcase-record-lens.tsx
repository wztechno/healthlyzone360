import { Redirect } from 'expo-router';

import { appConfig } from '../src/config.ts';
import { AreaShell } from '../src/shell/area-shell.tsx';
import { lazyScreen } from '../src/shell/lazy-screen.tsx';

/**
 * `/showcase-record-lens` — the Record lens on a page of its own, apart from `/showcase`, so the
 * redesign part can be judged in isolation. Development builds only, like the `/showcase` alias;
 * production sends the reader home.
 */
const RecordLensShowcaseScreen = lazyScreen(
    'record-lens-showcase-loading',
    async () =>
        (await import('../src/screens/record-lens-showcase-screen.tsx')).RecordLensShowcaseScreen,
);

export default function RecordLensShowcase() {
    if (!appConfig.isDevelopment) return <Redirect href="/" />;

    return (
        <AreaShell
            area="auth"
            variant="public"
            unguarded
            title="Record lens"
            testID="record-lens-showcase-shell"
        >
            <RecordLensShowcaseScreen />
        </AreaShell>
    );
}
