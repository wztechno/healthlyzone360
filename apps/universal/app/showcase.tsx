import { Redirect } from 'expo-router';

import { appConfig } from '../src/config.ts';
import { ShowcaseScreen } from '../src/screens/showcase-screen.tsx';
import { AreaShell } from '../src/shell/area-shell.tsx';

/**
 * `/showcase` — the development alias.
 *
 * The canonical home of the showcase is inside `platform-admin`, behind that area's permission
 * gate. This alias exists so a developer, a Playwright project and an axe run can reach it without
 * first arranging an administrator session — and it is **only** an alias in a non-production build.
 * In production it redirects to the guarded route, which will refuse anyone without the permission.
 */
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
