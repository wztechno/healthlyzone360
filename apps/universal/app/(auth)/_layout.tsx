import { Slot } from 'expo-router';

import { AreaShell } from '../../src/shell/area-shell.tsx';

/**
 * The `auth` area: sign in, register, verify, reset, and the two context pickers.
 *
 * Rendered `unguarded` because this *is* the way in — a gate here would redirect an anonymous
 * visitor to the sign-in page they are already on. The pickers are the exception and carry their
 * own `<Gate>`, since they need an authenticated, verified user.
 */
export default function AuthLayout() {
    return (
        <AreaShell area="auth" variant="auth" unguarded testID="auth-shell">
            <Slot />
        </AreaShell>
    );
}
