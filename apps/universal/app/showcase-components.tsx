import { AreaLookScope } from '@healthy360/design-system';
import { Redirect } from 'expo-router';

import { appConfig } from '../src/config.ts';
import { AreaShell } from '../src/shell/area-shell.tsx';
import { lazyScreen } from '../src/shell/lazy-screen.tsx';

/**
 * `/showcase-components` — the admin's current parts, one family per section. The page to check
 * before building anything: a part that is here is the one to use.
 * Development builds only; production sends the reader home.
 */
const ComponentsShowcaseScreen = lazyScreen(
    'components-showcase-loading',
    async () =>
        (await import('../src/screens/components-showcase-screen.tsx')).ComponentsShowcaseScreen,
);

export default function ComponentsShowcase() {
    return appConfig.isDevelopment ? (
        <AreaShell
            area="auth"
            variant="public"
            unguarded
            title="Components"
            testID="components-showcase-shell"
        >
            <AreaLookScope look="desk">
                <ComponentsShowcaseScreen />
            </AreaLookScope>
        </AreaShell>
    ) : (
        <Redirect href="/" />
    );
}
