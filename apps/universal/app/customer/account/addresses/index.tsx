import { lazyScreen } from '../../../../src/shell/lazy-screen.tsx';

/** `/customer/account/addresses` — every place this person's orders can go. */
const AddressesScreen = lazyScreen(
    'account-addresses-loading',
    async () => (await import('../../../../src/features/account/screens/index.ts')).AddressesScreen,
);

export default function CustomerAccountAddresses() {
    return <AddressesScreen />;
}
