import { resolveLandingRoute } from '@healthy360/permissions';

import { LandingScreen } from '../../../screens/landing-screen.tsx';
import { useAccessState, useSession } from '../../../session/session-provider.tsx';
import { MarketplaceShell } from '../../../shell/marketplace-shell.tsx';
import { PublicLandingScreen } from './public-landing-screen.tsx';

/**
 * `/` — one decision, three outcomes.
 *
 * | state                  | what happens                                                    |
 * | ---------------------- | --------------------------------------------------------------- |
 * | repositories failed    | the foundation's construction-failure screen                    |
 * | session restoring      | the foundation's splash                                         |
 * | anonymous              | the public marketplace landing page, in the marketplace chrome  |
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
 */
export function HomeRouter() {
    const accessState = useAccessState();
    const { repositoryError } = useSession();

    if (repositoryError !== null) return <LandingScreen />;

    const landing = resolveLandingRoute(accessState);

    if (landing.reason === 'unauthenticated') {
        return (
            <MarketplaceShell>
                <PublicLandingScreen />
            </MarketplaceShell>
        );
    }

    return <LandingScreen />;
}
