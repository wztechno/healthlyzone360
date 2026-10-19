import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';

/**
 * `<Redirect>`, but by `dismissTo`: when the destination is already an entry beneath — the page a
 * sign-in started from — the stack pops back to it instead of stacking a second copy on top, so
 * Back after arriving does not lead to the same page again.
 */
export function ReturnRedirect({ href }: { readonly href: string }) {
    const router = useRouter();
    useFocusEffect(
        useCallback(() => {
            router.dismissTo(href as never);
        }, [href, router]),
    );
    return null;
}
