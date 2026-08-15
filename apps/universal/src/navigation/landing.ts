import { isRouteArea } from '@healthy360/domain-types';
import { resolveLandingRoute } from '@healthy360/permissions';
import type { AccessState, LandingRoute } from '@healthy360/permissions';

import { isAreaAvailable, isPathAvailable } from '../features/availability.ts';

/** Where a landing route goes when the one the kernel picked has no backend behind it. */
const FALLBACK_HREF = '/workspace';

/**
 * `resolveLandingRoute`, with the unavailable destinations substituted.
 *
 * `@healthy360/permissions` answers a *permission* question — given this session, which screen is
 * the person entitled to start on — and it must keep answering exactly that: the gates read the same
 * resolver, so teaching it about missing endpoints would put "does this feature exist?" inside the
 * kernel that decides "may this person be here?" and make the two impossible to reason about
 * separately.
 *
 * So the substitution happens here instead, at the two call sites that launch the application. A
 * kiosk build lands on `/pos` and a driver build on `/driver`; neither area has endpoints yet, so
 * both would arrive at a route that immediately redirects home — a launch that flickers through two
 * screens to reach the third. Sending them straight to the workspace picker skips the flicker and
 * lands them somewhere that works.
 *
 * The `reason` is passed through untouched. It says why the *kernel* chose what it chose, and the
 * splash branches on `session_restoring` / `unauthenticated`; rewriting it to describe this
 * substitution would break both without telling anybody anything they can act on.
 */
export function resolveAppLandingRoute(state: AccessState): LandingRoute {
    const landing = resolveLandingRoute(state);
    const segment = landing.href.split('/')[1] ?? '';
    const areaAvailable = !isRouteArea(segment) || isAreaAvailable(segment);
    if (areaAvailable && isPathAvailable(landing.href)) return landing;
    return { href: FALLBACK_HREF, reason: landing.reason };
}
