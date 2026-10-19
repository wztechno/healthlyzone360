import { useLocalSearchParams } from 'expo-router';

import { Gate } from '../../src/access/gate.tsx';
import { VerifyEmailScreen } from '../../src/screens/verify-email-screen.tsx';

/**
 * Authenticated but *not* email-verified — that is the whole point of the screen, so the gate asks
 * for a session and nothing more. Asking for `requiresVerifiedEmail` here would redirect to itself.
 *
 * `?returnTo=` is the page the person was on their way to; Continue finishes there.
 */
export default function VerifyEmail() {
    const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
    return (
        <Gate area="auth" requirement={{ requiresAuth: true }}>
            <VerifyEmailScreen returnTo={returnTo} />
        </Gate>
    );
}
