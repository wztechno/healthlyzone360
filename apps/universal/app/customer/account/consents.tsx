import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/customer/account/consents` — what this person agreed to, in the words they agreed to.
 *
 * `?returnTo=` is the page that sent the person here, which its Done button goes back to.
 */
const ConsentsScreen = lazyScreen(
    'account-consents-loading',
    async () => (await import('../../../src/features/account/screens/index.ts')).ConsentsScreen,
);

export default function CustomerAccountConsents() {
    const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
    return <ConsentsScreen returnTo={returnTo} />;
}
