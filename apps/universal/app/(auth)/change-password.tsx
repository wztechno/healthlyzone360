import { Gate } from '../../src/access/gate.tsx';
import { ChangePasswordScreen } from '../../src/screens/change-password-screen.tsx';

/**
 * `/change-password` — replace a password from inside a live session.
 *
 * Authenticated, but explicitly **not** verified-email: this is where the landing resolver parks
 * somebody carrying a credential their administrator also knows, and an employee who has not yet
 * been given a mailbox must still be able to finish.
 */
export default function ChangePassword() {
    return (
        <Gate area="auth" requirement={{ requiresAuth: true }}>
            <ChangePasswordScreen />
        </Gate>
    );
}
