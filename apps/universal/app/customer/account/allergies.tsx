import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/customer/account/allergies` — the store of record for what this person cannot eat.
 *
 * `?returnTo=` is the page that sent the person here, which the screen goes back to once the
 * declaration is saved.
 */
const AllergiesScreen = lazyScreen(
    'account-allergies-loading',
    async () => (await import('../../../src/features/account/screens/index.ts')).AllergiesScreen,
);

export default function CustomerAccountAllergies() {
    const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
    return <AllergiesScreen returnTo={returnTo} />;
}
