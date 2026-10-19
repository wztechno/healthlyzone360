import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../../src/shell/lazy-screen.tsx';

/**
 * `/customer/account/addresses/{address}` — one address, added or amended.
 *
 * `{address}` is an identifier, or the literal `new`. One route rather than a `new.tsx` beside
 * this file: adding and editing differ only in whether the fields start empty, and a second route
 * would be a copy of the same screen with a different mutation at the bottom.
 *
 * `?returnTo=` is the page that sent the person here — the checkout, the plan setup — which the
 * screen goes back to once the address is saved.
 */
const AddressEditorScreen = lazyScreen(
    'account-address-editor-loading',
    async () =>
        (await import('../../../../src/features/account/screens/index.ts')).AddressEditorScreen,
);

export default function CustomerAccountAddress() {
    const { address, returnTo } = useLocalSearchParams<{ address?: string; returnTo?: string }>();
    return <AddressEditorScreen addressId={address} returnTo={returnTo} />;
}
