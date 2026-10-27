import { Redirect } from 'expo-router';

import { appConfig } from '../src/config.ts';
import { AreaShell } from '../src/shell/area-shell.tsx';
import { lazyScreen } from '../src/shell/lazy-screen.tsx';

/**
 * `/showcase-issue-tray` — the issue tray on a page of its own, apart from `/showcase`, so the
 * redesign part can be judged in isolation. Development builds only, like the `/showcase` alias;
 * production sends the reader home.
 */
const IssueTrayShowcaseScreen = lazyScreen(
    'issue-tray-showcase-loading',
    async () =>
        (await import('../src/screens/issue-tray-showcase-screen.tsx')).IssueTrayShowcaseScreen,
);

export default function IssueTrayShowcase() {
    if (!appConfig.isDevelopment) return <Redirect href="/" />;

    return (
        <AreaShell
            area="auth"
            variant="public"
            unguarded
            title="Issue tray"
            testID="issue-tray-showcase-shell"
        >
            <IssueTrayShowcaseScreen />
        </AreaShell>
    );
}
