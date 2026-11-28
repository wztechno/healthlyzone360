import { AreaLookScope } from '@healthy360/design-system';
import { Redirect } from 'expo-router';

import { appConfig } from '../src/config.ts';
import { AreaShell } from '../src/shell/area-shell.tsx';
import { lazyScreen } from '../src/shell/lazy-screen.tsx';

/**
 * `/showcase-process-steps` — the stepped posting form's parts (Receive a delivery, Post a goods
 * receipt), on a page of their own. Development builds only; production sends the reader home.
 */
const ProcessStepsShowcaseScreen = lazyScreen(
    'process-steps-showcase-loading',
    async () =>
        (await import('../src/screens/process-steps-showcase-screen.tsx'))
            .ProcessStepsShowcaseScreen,
);

export default function ProcessStepsShowcase() {
    if (!appConfig.isDevelopment) return <Redirect href="/" />;

    return (
        <AreaShell
            area="auth"
            variant="public"
            unguarded
            title="Process steps"
            testID="process-steps-showcase-shell"
        >
            <AreaLookScope look="desk">
                <ProcessStepsShowcaseScreen />
            </AreaLookScope>
        </AreaShell>
    );
}
