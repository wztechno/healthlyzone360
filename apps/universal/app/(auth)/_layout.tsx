import { Slot, useSegments } from 'expo-router';

import { AreaShell } from '../../src/shell/area-shell.tsx';
import { AuthAside } from '../../src/ui/auth-aside.tsx';
import { AuthFrame } from '../../src/ui/auth-frame.tsx';

/**
 * The pages rebuilt as the accepted sign-in boards, drawn in the boards' frame — the stage and the
 * form side (`ui/auth-frame.tsx`). The rest keep the shell's `auth` variant until their board is
 * built; the staff branch and organisation pickers are not shop pages and keep it for good.
 */
const BOARD_PAGES: ReadonlySet<string> = new Set([
    'sign-in',
    'register',
    'change-password',
    'forgot-password',
    'reset-password',
    'verify-email',
]);

/**
 * The `auth` area: sign in, register, verify, reset, and the two context pickers.
 *
 * Rendered `unguarded` because this *is* the way in — a gate here would redirect an anonymous
 * visitor to the sign-in page they are already on. The pickers are the exception and carry their
 * own `<Gate>`, since they need an authenticated, verified user.
 *
 * In the shell, the canopy brand panel rides beside the card from `lg` up (the handoff's
 * split-panel opening); below that the centred card keeps the whole width, unchanged.
 */
export default function AuthLayout() {
    const segments = useSegments() as readonly string[];
    const page = segments[segments.length - 1];

    if (page !== undefined && BOARD_PAGES.has(page)) {
        return (
            <AuthFrame>
                <Slot />
            </AuthFrame>
        );
    }

    return (
        <AreaShell
            area="auth"
            variant="auth"
            unguarded
            testID="auth-shell"
            authAside={<AuthAside />}
        >
            <Slot />
        </AreaShell>
    );
}
