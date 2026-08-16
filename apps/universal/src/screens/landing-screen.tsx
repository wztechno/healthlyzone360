import { ErrorState, Heading, Stack } from '@healthy360/design-system';
import { apiFailure } from '@healthy360/api-client';
import { Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { resolveAppLandingRoute } from '../navigation/landing.ts';
import { SproutMark } from '../ui/sprout-mark.tsx';
import { useAccessState, useSession } from '../session/session-provider.tsx';

/**
 * The `/` route: session restoration, then a redirect.
 *
 * Where a launching application should land is decided by `resolveLandingRoute` in
 * `@healthy360/permissions` — the same ordering the gates use, so the splash and the guards can
 * never disagree about, say, whether an unverified user should see the organisation picker. It is
 * read through `../navigation/landing.ts`, which substitutes the workspace for a destination whose
 * area has no backend yet; see that file for why the substitution is not in the kernel.
 *
 * A repository *construction* failure is rendered here rather than swallowed. In practice that
 * means the missing-base-URL guard, and a build that trips it must say so loudly on its very first
 * screen.
 *
 * ## Neither state here is `landing-screen`
 *
 * That test id belongs to {@link PublicLandingScreen}, the marketplace page an anonymous visitor
 * actually lands on. Both states below used to carry it too, and the collision was not cosmetic:
 * `/` renders *this* screen while the session restores, so anything keying on `landing-screen` to
 * mean "the visitor is anonymous" matched the restoring splash first — a signed-in user, one frame
 * after `router.replace('/')`, with `me()` still in flight. Two different screens answering to one
 * name is a question no caller can ask correctly, so they answer to three.
 */
export function LandingScreen() {
    const { t } = useTranslation();
    const accessState = useAccessState();
    const { repositoryError } = useSession();

    if (repositoryError !== null) {
        return (
            <Stack testID="repository-error-screen" space="lg" className="p-4">
                <Heading level={1}>{t('errors:generic.title')}</Heading>
                <ErrorState
                    testID="repository-error"
                    failure={apiFailure('server', { message: repositoryError.message })}
                />
            </Stack>
        );
    }

    const landing = resolveAppLandingRoute(accessState);

    if (landing.reason === 'session_restoring') {
        return (
            /*
             * The card, the spinner and the wordmark are all gone. What is left is the mark on the
             * page's own ground: a splash that says nothing is better than a splash that apologises,
             * and the sentence this used to show still reaches anyone using a screen reader through
             * the mark's accessible name. `session-restoring-screen` stays — `e2e/specs/helpers.ts`
             * depends on this splash *not* answering to `landing-screen`, because "still restoring"
             * is a reason to keep waiting rather than a result.
             */
            <Stack
                testID="session-restoring-screen"
                space="md"
                align="center"
                justify="center"
                className="flex-1 p-8"
            >
                <SproutMark testID="session-restoring" label={t('common:state.restoringSession')} />
            </Stack>
        );
    }

    return <Redirect href={landing.href as never} />;
}
