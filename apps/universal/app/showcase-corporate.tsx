import { AreaLookScope } from '@healthy360/design-system';
import { Redirect } from 'expo-router';

import { appConfig } from '../src/config.ts';
import { AreaShell } from '../src/shell/area-shell.tsx';
import { lazyScreen } from '../src/shell/lazy-screen.tsx';

/**
 * `/showcase-corporate` — the parts the corporate B2B canvas (2026-11-10) added: the choice chips,
 * the pack stepper, the picked-lines bar, the send checklist, and the record sheet's progress strip
 * and full-width lines. Development builds only; production sends the reader home.
 */
const CorporateShowcaseScreen = lazyScreen(
    'corporate-showcase-loading',
    async () =>
        (await import('../src/screens/corporate-showcase-screen.tsx')).CorporateShowcaseScreen,
);

export default function CorporateShowcase() {
    if (!appConfig.isDevelopment) return <Redirect href="/" />;

    return (
        <AreaShell
            area="auth"
            variant="public"
            unguarded
            title="Corporate parts"
            testID="corporate-showcase-shell"
        >
            <AreaLookScope look="desk">
                <CorporateShowcaseScreen />
            </AreaLookScope>
        </AreaShell>
    );
}
