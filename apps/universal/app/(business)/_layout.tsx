import { Slot } from 'expo-router';

import { AreaShell } from '../../src/shell/area-shell.tsx';

/**
 * The `(business)` route group — B2B onboarding (plan Phase B1, appendix E §B.2).
 *
 * ## Why a group and not an area
 *
 * A B2B applicant is a **registered person with no organisation**: the corporate organisation is
 * created *by* approval, not before it. So there is nothing for a `corporate` gate to check — no
 * membership, no active context, no organisation-scoped permission — and a new `RouteArea` would
 * have to be defined as "authenticated, and nothing else", which is exactly what `customer` already
 * is. D-027 records the decision: **no new route area**, gate as `area="customer"`.
 *
 * The parentheses matter. `(business)` is a *layout* group: it gives these routes a shared shell
 * without appearing in the URL, so the applicant's address is `/apply`, not `/business/apply`. That
 * is the address a person reaches from an email, quotes to support and bookmarks — and it stays
 * stable whether or not the group is later renamed.
 *
 * ## Why the consumer chrome rather than the workspace chrome
 *
 * There is no workspace to navigate. An applicant has one thing to do and five screens to do it in,
 * and a sidebar full of corporate destinations they cannot open yet would be a list of doors that
 * are all locked. `variant="public"` is `customer`'s own chrome — a plain top bar — and the
 * workspace navigation arrives with the organisation, at `/corporate`.
 */
export default function BusinessLayout() {
    return (
        <AreaShell area="customer" title="Business account" testID="business-shell">
            <Slot />
        </AreaShell>
    );
}
