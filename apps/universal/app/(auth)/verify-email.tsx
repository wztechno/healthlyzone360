import { Gate } from '../../src/access/gate.tsx';
import { VerifyEmailScreen } from '../../src/screens/verify-email-screen.tsx';

/**
 * Authenticated but *not* email-verified — that is the whole point of the screen, so the gate asks
 * for a session and nothing more. Asking for `requiresVerifiedEmail` here would redirect to itself.
 */
export default function VerifyEmail() {
    return (
        <Gate area="auth" requirement={{ requiresAuth: true }}>
            <VerifyEmailScreen />
        </Gate>
    );
}
