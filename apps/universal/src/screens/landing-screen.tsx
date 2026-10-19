import { ErrorState, Heading, Stack } from '@healthy360/design-system';
import { apiFailure } from '@healthy360/api-client';
import { isRouteArea } from '@healthy360/domain-types';
import type { RouteArea } from '@healthy360/domain-types';
import { evaluateGates, requirementForArea } from '@healthy360/permissions';
import type { AccessState } from '@healthy360/permissions';
import { Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { resolveAppLandingRoute } from '../navigation/landing.ts';
import { ReturnRedirect } from '../navigation/return-redirect.tsx';
import { isPublicHref, pathnameOf, safeReturnTo, withReturnTo } from '../navigation/return-to.ts';
import { SproutMark } from '../ui/sprout-mark.tsx';
import { useAccessState, useSession } from '../session/session-provider.tsx';

/**
 * The route area that gates an href, or `null` for a gated path that is not an area. `/apply` is the
 * `(business)` group, which gates as `customer` (D-027); the workspace group (`/workspace`,
 * `/profile`, `/devices`) asks for a verified session and nothing more, which a `workspace` landing
 * already is.
 */
function gatingAreaOf(href: string): RouteArea | null {
    const pathname = pathnameOf(href);
    if (pathname === '/apply' || pathname.startsWith('/apply/')) return 'customer';
    const first = pathname.split('/')[1] ?? '';
    return isRouteArea(first) ? first : null;
}

/**
 * Whether a session that has landed may be sent on to `href`: the same kernel the destination's own
 * `<Gate>` will run, asked first, so a return into an area this person cannot open lands them on
 * their home instead of on a forbidden page.
 */
function mayReturnTo(state: AccessState, href: string): boolean {
    if (isPublicHref(href)) return true;
    const area = gatingAreaOf(href);
    if (area === null) return true;
    return evaluateGates(state, requirementForArea(area)).status === 'allow';
}

export interface LandingScreenProps {
    /** Where a finished sign-in asked to go (`/?returnTo=`). Validated again here. */
    readonly returnTo?: string | null | undefined;
}

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
 * That test id belonged to the marketplace page an anonymous visitor used to land on at `/` (they
 * are sent to `/discover` now). Both states below used to carry it too, and the collision was not cosmetic:
 * `/` renders *this* screen while the session restores, so anything keying on `landing-screen` to
 * mean "the visitor is anonymous" matched the restoring splash first — a signed-in user, one frame
 * after `router.replace('/')`, with `me()` still in flight. Two different screens answering to one
 * name is a question no caller can ask correctly, so they answer to three.
 *
 * ## Finishing at the return (AUTH-02)
 *
 * Every authentication finishes by replacing itself with `/?returnTo=…` (`useCompleteAuth`), and
 * this is where the return is honoured — after the resolver, never instead of it, because the
 * resolver is what knows the session still owes something:
 *
 * | landing reason                                  | with a return                              |
 * | ----------------------------------------------- | ------------------------------------------ |
 * | `workspace`, and the return's gate would allow  | on to the return (`dismissTo`)             |
 * | `email_unverified`, `password_change_required`  | to that step, carrying the return          |
 * | anything else — the organisation/branch pickers | the resolver's page; the return is dropped |
 *
 * `dismissTo` rather than a replace, so a sign-in that was pushed from a marketplace page pops back
 * to that page instead of stacking a second copy of it. The pickers drop the return on purpose:
 * they choose where a member of staff works, and the page they asked for may not exist in the
 * context they pick (the shared kitchen-admin flow behaves exactly as before).
 */
export function LandingScreen({ returnTo: rawReturnTo = null }: LandingScreenProps = {}) {
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

    const returnTo = safeReturnTo(rawReturnTo);
    if (returnTo !== null) {
        if (landing.reason === 'workspace' && mayReturnTo(accessState, returnTo)) {
            return <ReturnRedirect href={returnTo} />;
        }
        if (
            landing.reason === 'email_unverified' ||
            landing.reason === 'password_change_required'
        ) {
            return <Redirect href={withReturnTo(landing.href, returnTo) as never} />;
        }
    }

    return <Redirect href={landing.href as never} />;
}
