import { Redirect } from 'expo-router';

import { appConfig } from '../src/config.ts';
import { AreaShell } from '../src/shell/area-shell.tsx';
import { lazyScreen } from '../src/shell/lazy-screen.tsx';

/**
 * `/showcase-notices` — the notice on a page of its own, apart from `/showcase`, so the redesign
 * part can be judged in isolation. Development builds only, like the `/showcase` alias; production
 * sends the reader home.
 */
const NoticeShowcaseScreen = lazyScreen(
    'notice-showcase-loading',
    async () => (await import('../src/screens/notice-showcase-screen.tsx')).NoticeShowcaseScreen,
);

export default function NoticeShowcase() {
    if (!appConfig.isDevelopment) return <Redirect href="/" />;

    return (
        <AreaShell
            area="auth"
            variant="public"
            unguarded
            title="Notices"
            testID="notice-showcase-shell"
        >
            <NoticeShowcaseScreen />
        </AreaShell>
    );
}
