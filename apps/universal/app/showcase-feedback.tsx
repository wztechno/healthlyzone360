import { AreaLookScope } from '@healthy360/design-system';
import { Redirect } from 'expo-router';

import { appConfig } from '../src/config.ts';
import { AreaShell } from '../src/shell/area-shell.tsx';
import { lazyScreen } from '../src/shell/lazy-screen.tsx';

/**
 * `/showcase-feedback` — the kitchen's toasts, pop-ups and notice strips on a page of their own,
 * apart from `/showcase`. Development builds only; production sends the reader home.
 */
const FeedbackShowcaseScreen = lazyScreen(
    'feedback-showcase-loading',
    async () =>
        (await import('../src/screens/feedback-showcase-screen.tsx')).FeedbackShowcaseScreen,
);

export default function FeedbackShowcase() {
    return appConfig.isDevelopment ? (
        <AreaShell
            area="auth"
            variant="public"
            unguarded
            title="Toasts, pop-ups and banners"
            testID="feedback-showcase-shell"
        >
            <AreaLookScope look="desk">
                <FeedbackShowcaseScreen />
            </AreaLookScope>
        </AreaShell>
    ) : (
        <Redirect href="/" />
    );
}
