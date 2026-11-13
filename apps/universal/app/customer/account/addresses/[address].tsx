import { useLocalSearchParams } from 'expo-router';

import type { AddressEditorScreenProps } from '../../../../src/features/account/screens/index.ts';
import { lazyScreen } from '../../../../src/shell/lazy-screen.tsx';

/**
 * `/customer/account/addresses/{address}` — one address, added or amended.
 *
 * `{address}` is an identifier, or the literal `new`. One route rather than a `new.tsx` beside
 * this file: adding and editing differ only in whether the fields start empty, and a second route
 * would be a copy of the same screen with a different mutation at the bottom.
 *
 * Drawn inside the account page, as the board draws it: the band and the side menu stay, with
 * Addresses chosen, and the editor is the pane beside them.
 *
 * `?returnTo=` is the page that sent the person here — the checkout, the plan setup — which the
 * screen goes back to once the address is saved.
 */
const AccountAddress = lazyScreen<AddressEditorScreenProps>(
    'account-address-editor-loading',
    async () => {
        const { AccountScreen, AddressEditorScreen } =
            await import('../../../../src/features/account/screens/index.ts');
        return function AccountAddressPage(props: AddressEditorScreenProps) {
            return (
                <AccountScreen section="addresses">
                    <AddressEditorScreen {...props} />
                </AccountScreen>
            );
        };
    },
);

export default function CustomerAccountAddress() {
    const { address, returnTo } = useLocalSearchParams<{ address?: string; returnTo?: string }>();
    return <AccountAddress addressId={address} returnTo={returnTo} />;
}
