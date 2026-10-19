import { useLocalSearchParams } from 'expo-router';

import { Gate } from '../../src/access/gate.tsx';
import { ChangePasswordScreen } from '../../src/screens/change-password-screen.tsx';

/**
 * `/change-password` — replace a password from inside a live session.
 *
 * Authenticated, but explicitly **not** verified-email: this is where the landing resolver parks
 * somebody carrying a credential their administrator also knows, and an employee who has not yet
 * been given a mailbox must still be able to finish.
 *
 * `?returnTo=` is where to go afterwards — the page a forced change interrupted, or the settings
 * page a voluntary one was opened from.
 */
export default function ChangePassword() {
    const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
    return (
        <Gate area="auth" requirement={{ requiresAuth: true }}>
            <ChangePasswordScreen returnTo={returnTo} />
        </Gate>
    );
}
