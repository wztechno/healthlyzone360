import { useLocalSearchParams } from 'expo-router';

import { Gate } from '../../src/access/gate.tsx';
import { lazyScreen } from '../../src/shell/lazy-screen.tsx';

/**
 * `/verify-phone` — where a link, a redirect or a resumed session lands.
 *
 * `?challenge=` carries a live challenge so that a page load recovers it — cooldown intact —
 * instead of issuing a second code (`contracts/verification.ts`, journey-forced shape 1).
 *
 * Authenticated but nothing more, on the same reasoning as `/verify-email`: the contact being
 * confirmed belongs to an account, so there has to be a session, and asking for a *verified* one
 * would be asking a person to finish the thing they came here to start.
 */
const VerifyPhoneScreen = lazyScreen(
    'verify-phone-loading',
    async () => (await import('../../src/features/account/screens/index.ts')).VerifyPhoneScreen,
);

export default function VerifyPhone() {
    const { challenge } = useLocalSearchParams<{ challenge?: string }>();

    return (
        <Gate area="auth" requirement={{ requiresAuth: true }}>
            <VerifyPhoneScreen challengeId={challenge} />
        </Gate>
    );
}
