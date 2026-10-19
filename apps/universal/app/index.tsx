import { useLocalSearchParams } from 'expo-router';

import { HomeRouter } from '../src/features/marketplace/screens/home-router.tsx';
import { safeReturnTo } from '../src/navigation/return-to.ts';

/**
 * `/` — session-restoration splash, the public marketplace for an anonymous visitor, and otherwise
 * a redirect to wherever the kernel says this user belongs.
 *
 * `/?returnTo=…` is how a sign-in, a registration's verification or a forced password change
 * finishes (`useCompleteAuth`): the landing decides whether the session may go there yet. The value
 * is validated here, once, before anything below can route to it.
 */
export default function Index() {
    const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
    return <HomeRouter returnTo={safeReturnTo(returnTo)} />;
}
