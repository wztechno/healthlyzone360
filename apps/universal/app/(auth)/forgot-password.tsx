import { useLocalSearchParams } from 'expo-router';

import { RedirectIfSignedIn } from '../../src/navigation/redirect-if-signed-in.tsx';
import { safeReturnTo } from '../../src/navigation/return-to.ts';
import { ForgotPasswordScreen } from '../../src/screens/forgot-password-screen.tsx';

/**
 * `/forgot-password?returnTo=…` — the return is only passed through, so "Back to sign in" still
 * finishes where the person started.
 */
export default function ForgotPassword() {
    const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
    return (
        <RedirectIfSignedIn returnTo={safeReturnTo(returnTo)}>
            <ForgotPasswordScreen returnTo={returnTo} />
        </RedirectIfSignedIn>
    );
}
