import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { isPublicHref } from './return-to.ts';
import { useGoBackOr } from './use-return-to.ts';

/**
 * "Keep browsing" — the one quiet way out of the sign-in, registration and email-confirmation cards
 * (AUTH-07).
 *
 * Sign-in's exit used to read "Continue as a guest" and replace to `/`: guests cannot order, and `/`
 * is not where the person was. Register and verify-email had no exit at all, and the auth chrome
 * has no header to fall back on. So all three offer the same control, and it does what it says:
 *
 * - a **public** return is the page the person left — a kitchen, a meal, the menu with its filters
 *   — so the stack pops back to it (`dismissTo`, never a second copy on top);
 * - a **gated** return (checkout, the basket) is exactly what they chose not to sign in for, so
 *   sending them there would only bounce them back here. Back is the honest answer, and after a
 *   refresh or a deep link, where there is no Back, the marketplace home.
 *
 * @param returnTo the screen's validated return, or `null`.
 */
export function useKeepBrowsing(returnTo: string | null): () => void {
    const router = useRouter();
    const goBackOr = useGoBackOr();
    return useCallback(() => {
        if (returnTo !== null && isPublicHref(returnTo)) {
            router.dismissTo(returnTo as never);
            return;
        }
        goBackOr('/discover');
    }, [goBackOr, returnTo, router]);
}
