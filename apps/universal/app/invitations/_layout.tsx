import { Slot } from 'expo-router';

import { AreaShell } from '../../src/shell/area-shell.tsx';

/**
 * The invitation landing area.
 *
 * A real segment rather than a group, because `/invitations/{token}` is the path the mailed link
 * carries — `KitchenOwners::acceptUrl()` builds `{FRONTEND_URL}/invitations/{token}` — and the URL
 * is therefore not ours to shorten.
 *
 * **`unguarded`, which nothing outside `(auth)` normally is.** The gate cannot help here and would
 * actively hurt: the visitor is anonymous by construction, and every guard available would either
 * bounce them to a sign-in page that does not say why, or to `/forbidden`. The screen does its own
 * gating instead, and it gates on the *invitation*, which is the thing that actually decides what
 * may happen next. The API remains the authority — acceptance is refused server-side for anybody
 * whose address does not match.
 *
 * `variant="auth"` for the card chrome: this is a one-decision page reached from outside the
 * application, which is exactly what that variant is for, and it draws no navigation to a workspace
 * the visitor may not yet be a member of.
 */
export default function InvitationsLayout() {
    return (
        <AreaShell area="public" variant="auth" unguarded testID="invitation-shell">
            <Slot />
        </AreaShell>
    );
}
