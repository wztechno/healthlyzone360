import { Redirect } from 'expo-router';

import { appConfig } from '../src/config.ts';
import { AreaShell } from '../src/shell/area-shell.tsx';
import { lazyScreen } from '../src/shell/lazy-screen.tsx';

/**
 * `/showcase-record-popup` — the record pop-up every admin View opens as, on a page of its own.
 * Development builds only, like the `/showcase` alias; production sends the reader home.
 */
const RecordPopupShowcaseScreen = lazyScreen(
    'record-popup-showcase-loading',
    async () =>
        (await import('../src/screens/record-popup-showcase-screen.tsx')).RecordPopupShowcaseScreen,
);

export default function RecordPopupShowcase() {
    if (!appConfig.isDevelopment) return <Redirect href="/" />;

    return (
        <AreaShell
            area="auth"
            variant="public"
            unguarded
            title="Record pop-up"
            testID="record-popup-showcase-shell"
        >
            <RecordPopupShowcaseScreen />
        </AreaShell>
    );
}
