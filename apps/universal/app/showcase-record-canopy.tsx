import { Redirect } from 'expo-router';

import { appConfig } from '../src/config.ts';
import { AreaShell } from '../src/shell/area-shell.tsx';
import { lazyScreen } from '../src/shell/lazy-screen.tsx';

/**
 * `/showcase-record-canopy` — the record canopy and its tiles on a page of their own, apart from
 * `/showcase`, so the redesign part can be judged in isolation. Development builds only, like the
 * `/showcase` alias; production sends the reader home.
 */
const RecordCanopyShowcaseScreen = lazyScreen(
    'record-canopy-showcase-loading',
    async () =>
        (await import('../src/screens/record-canopy-showcase-screen.tsx'))
            .RecordCanopyShowcaseScreen,
);

export default function RecordCanopyShowcase() {
    if (!appConfig.isDevelopment) return <Redirect href="/" />;

    return (
        <AreaShell
            area="auth"
            variant="public"
            unguarded
            title="Record canopy"
            testID="record-canopy-showcase-shell"
        >
            <RecordCanopyShowcaseScreen />
        </AreaShell>
    );
}
