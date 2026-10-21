import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/customer/account` — the setup checklist, and the settings a person keeps coming back to.
 *
 * `?section=` is the open section (the screen reads it itself, and follows it). `?returnTo=` is set
 * when another flow opened a section as a detour — the closure wizard's "Sort this out".
 */
const AccountScreen = lazyScreen(
    'account-loading',
    async () => (await import('../../../src/features/account/screens/index.ts')).AccountScreen,
);

export default function CustomerAccount() {
    const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
    return <AccountScreen returnTo={returnTo} />;
}
