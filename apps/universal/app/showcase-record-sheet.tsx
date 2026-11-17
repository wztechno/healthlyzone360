import { Redirect } from 'expo-router';

import { appConfig } from '../src/config.ts';
import { AreaShell } from '../src/shell/area-shell.tsx';
import { lazyScreen } from '../src/shell/lazy-screen.tsx';

/**
 * `/showcase-record-sheet` — the record pop-up without its green band (option A of `Record pop-up —
 * no canopy`, 2026-11-17) on a page of its own, apart from `/showcase`, so the redesign can be
 * judged in isolation. Development builds only, like the `/showcase` alias; production sends the
 * reader home.
 */
const RecordSheetShowcaseScreen = lazyScreen(
    'record-sheet-showcase-loading',
    async () =>
        (await import('../src/screens/record-sheet-showcase-screen.tsx')).RecordSheetShowcaseScreen,
);

export default function RecordSheetShowcase() {
    if (!appConfig.isDevelopment) return <Redirect href="/" />;

    return (
        <AreaShell
            area="auth"
            variant="public"
            unguarded
            title="Record sheet"
            testID="record-sheet-showcase-shell"
        >
            <RecordSheetShowcaseScreen />
        </AreaShell>
    );
}
