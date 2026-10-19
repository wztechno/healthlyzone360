import { Redirect } from 'expo-router';

import { withReturnTo } from '../../src/navigation/return-to.ts';
import { useSession } from '../../src/session/session-provider.tsx';

/**
 * `/guest-checkout` — retired; kept as an address that still leads somewhere (AUTH-17).
 *
 * It was ordering without an account. A basket needs a verified session (BUG-19, a guest's
 * `POST /carts` is a 401 by design), so the screen behind this route could never price anything:
 * signed out its basket skeleton spun forever, and signed in it asked for contact details the
 * account already has. Nothing in the application links here any more — "Continue as a guest" was
 * removed from the Add dialog — but an old link or a bookmark still can.
 *
 * So the address forwards to the one checkout that works: the basket, for somebody signed in, and
 * sign-in with the basket as its return for somebody who is not. Both are `<Redirect>`s, so this
 * entry is replaced rather than left behind Back. While the session restores nothing is decided.
 */
export default function GuestCheckout() {
    const { phase } = useSession();
    if (phase === 'restoring') return null;
    if (phase === 'anonymous') {
        return <Redirect href={withReturnTo('/sign-in', '/customer/cart') as never} />;
    }
    return <Redirect href="/customer/cart" />;
}
