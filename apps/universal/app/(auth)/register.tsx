import { useLocalSearchParams } from 'expo-router';

import { RedirectIfSignedIn } from '../../src/navigation/redirect-if-signed-in.tsx';
import { safeReturnTo } from '../../src/navigation/return-to.ts';
import { RegisterScreen } from '../../src/screens/register-screen.tsx';

/**
 * `/register?returnTo=…` — the return is carried on to `/verify-email`, whose Continue finishes
 * there. A visitor who is already signed in is sent on rather than shown the form.
 */
export default function Register() {
    const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
    return (
        <RedirectIfSignedIn returnTo={safeReturnTo(returnTo)}>
            <RegisterScreen returnTo={returnTo} />
        </RedirectIfSignedIn>
    );
}
