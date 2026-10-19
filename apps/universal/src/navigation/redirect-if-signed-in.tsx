import { Redirect, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';

import { useSession } from '../session/session-provider.tsx';
import { withReturnTo } from './return-to.ts';

export interface RedirectIfSignedInProps {
    /** The route's validated `?returnTo=`, passed on so a signed-in visitor still lands there. */
    readonly returnTo: string | null;
    readonly children: ReactNode;
}

/**
 * Sign-in, registration and "forgot password" are ways *in*. A person who is already in has no use
 * for them, and showing them a working form anyway is how Back after signing up came to offer a
 * signed-in person a second sign-in (AUTH-05): auth pages left behind in history, a refresh of
 * `/sign-in` in a signed-in tab, a bookmark.
 *
 * So a signed-in visitor is replaced on through `/` — the launch resolver, which knows whether the
 * session is ready for the page they wanted or still owes a password change or an email
 * confirmation — with their `returnTo` carried, so nothing they were doing is lost.
 *
 * ## Except when the sign-in happened here
 *
 * A successful submit flips the session from anonymous to signed in *on this very screen*, and the
 * screen then finishes its own way: sign-in through `useCompleteAuth`, registration on to
 * `/verify-email`. Redirecting as well would race two navigations for the same moment. So the
 * wrapper only acts on a session that was already signed in when the page was reached: once it has
 * seen the person anonymous here, the page is theirs to finish. The flag is reset when the page
 * loses focus, because a stack that keeps the page mounted underneath would otherwise remember a
 * visit that has ended.
 *
 * While the session is still restoring nothing is decided and the page renders as it always has.
 */
export function RedirectIfSignedIn({ returnTo, children }: RedirectIfSignedInProps) {
    const { phase } = useSession();
    const [sawAnonymous, setSawAnonymous] = useState(phase === 'anonymous');

    // Derived from the session during render rather than in an effect, so the frame in which the
    // person becomes anonymous is the frame that remembers it.
    if (phase === 'anonymous' && !sawAnonymous) setSawAnonymous(true);

    useFocusEffect(
        useCallback(
            () => () => {
                setSawAnonymous(false);
            },
            [],
        ),
    );

    const signedIn = phase !== 'anonymous' && phase !== 'restoring';
    if (signedIn && !sawAnonymous) return <Redirect href={withReturnTo('/', returnTo) as never} />;

    return <>{children}</>;
}
