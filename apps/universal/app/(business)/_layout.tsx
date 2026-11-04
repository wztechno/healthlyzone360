import { Slot } from 'expo-router';

import { ConsumerShell } from '../../src/shell/consumer-shell.tsx';

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
 * ## Why the shop's chrome
 *
 * There is no workspace to navigate. An applicant has one thing to do and five screens to do it in,
 * so the pages sit in the shop they came from — its floating header and footer, as the application
 * boards draw them (`ConsumerShell`, which applies the same `customer` gate). The workspace
 * navigation arrives with the organisation, at `/corporate`.
 */
export default function BusinessLayout() {
    return (
        <ConsumerShell>
            <Slot />
        </ConsumerShell>
    );
}
