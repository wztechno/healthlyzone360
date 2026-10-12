import { Redirect } from 'expo-router';

import { resolveAppLandingRoute } from '../../../navigation/landing.ts';
import { LandingScreen } from '../../../screens/landing-screen.tsx';
import { useAccessState, useSession } from '../../../session/session-provider.tsx';

/**
 * `/` — one decision, three outcomes.
 *
 * | state                  | what happens                                                    |
 * | ---------------------- | --------------------------------------------------------------- |
 * | repositories failed    | the foundation's construction-failure screen                    |
 * | session restoring      | the foundation's splash                                         |
 * | anonymous              | straight to `/discover`, the marketplace home                   |
 * | anything else          | the foundation's redirect, unchanged                            |
 *
 * ## Why this delegates rather than reimplements
 *
 * `LandingScreen` already resolves the destination through `resolveLandingRoute` — the same
 * ordering the gates use, which is what stops the splash and the guards ever disagreeing. Copying
 * that logic here to add one branch would create a second implementation of the most
 * safety-relevant routing decision in the application, and the two would drift the first time
 * either changed.
 *
 * So exactly one case is intercepted — `unauthenticated`, which used to redirect to `/sign-in` —
 * and every other case is handed straight back to the untouched foundation screen. The reason for
 * intercepting it is that "anonymous" no longer means "you must sign in": it now means a person has
 * arrived at a public marketplace, and demanding credentials before showing them anything is the
 * opposite of what a marketplace is for.
 *
 * ## A redirect, not a second copy of the page
 *
 * `/`, `/customer` and `/discover` each used to draw the design's home from the same sections, so
 * the site carried three near-identical pages that only differed in one button. There is one home
 * now, `/discover`, and both of the others send the person there.
 */
export function HomeRouter() {
    const accessState = useAccessState();
    const { repositoryError } = useSession();

    if (repositoryError !== null) return <LandingScreen />;

    const landing = resolveAppLandingRoute(accessState);

    if (landing.reason === 'unauthenticated') return <Redirect href="/discover" />;

    return <LandingScreen />;
}
