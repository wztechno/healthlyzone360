import { HomeRouter } from '../src/features/marketplace/screens/home-router.tsx';

/**
 * `/` — session-restoration splash, the public marketplace for an anonymous visitor, and otherwise
 * a redirect to wherever the kernel says this user belongs.
 */
export default function Index() {
    return <HomeRouter />;
}
