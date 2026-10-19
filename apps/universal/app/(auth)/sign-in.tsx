import { useLocalSearchParams } from 'expo-router';

import { RedirectIfSignedIn } from '../../src/navigation/redirect-if-signed-in.tsx';
import { safeReturnTo } from '../../src/navigation/return-to.ts';
import { SignInScreen } from '../../src/screens/sign-in-screen.tsx';

/**
 * `/sign-in?returnTo=…` — the page that sent the person here (a gate, the header, an Add to basket)
 * rides in `returnTo`, and signing in finishes there. A visitor who is already signed in is sent on
 * rather than shown the form.
 */
export default function SignIn() {
    const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
    return (
        <RedirectIfSignedIn returnTo={safeReturnTo(returnTo)}>
            <SignInScreen returnTo={returnTo} />
        </RedirectIfSignedIn>
    );
}
