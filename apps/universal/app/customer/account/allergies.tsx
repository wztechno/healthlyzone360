import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/customer/account/allergies` — the store of record for what this person cannot eat. */
const AllergiesScreen = lazyScreen(
    'account-allergies-loading',
    async () => (await import('../../../src/features/account/screens/index.ts')).AllergiesScreen,
);

export default function CustomerAccountAllergies() {
    return <AllergiesScreen />;
}
