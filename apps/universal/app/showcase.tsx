import { Redirect } from 'expo-router';

import { appConfig } from '../src/config.ts';
import { AreaShell } from '../src/shell/area-shell.tsx';
import { lazyScreen } from '../src/shell/lazy-screen.tsx';

/**
 * `/showcase` — the development alias.
 *
 * The canonical home of the showcase is inside `platform-admin`, behind that area's permission
 * gate. This alias exists so a developer, a Playwright project and an axe run can reach it without
 * first arranging an administrator session — and it is **only** an alias in a non-production build.
 * In production it redirects to the guarded route, which will refuse anyone without the permission.
 *
 * Split, and split *here as well as* in `platform-admin/showcase.tsx`: the gallery is one screen
 * that renders every component in the design system, and a static import from either of its two
 * routes would put the whole thing back in the entry bundle for everybody who never opens it.
 */
const ShowcaseScreen = lazyScreen(
    'showcase-loading',
    async () => (await import('../src/screens/showcase-screen.tsx')).ShowcaseScreen,
);

export default function ShowcaseAlias() {
    if (!appConfig.isDevelopment) {
        return <Redirect href="/platform-admin/showcase" />;
    }

    return (
        <AreaShell
            area="auth"
            variant="public"
            unguarded
            title="Design system"
            testID="showcase-shell"
        >
            <ShowcaseScreen />
        </AreaShell>
    );
}
