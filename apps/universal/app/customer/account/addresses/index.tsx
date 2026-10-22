import { Redirect, useLocalSearchParams } from 'expo-router';

import { withReturnTo } from '../../../../src/navigation/return-to.ts';

/**
 * `/customer/account/addresses` — the account page's Addresses section.
 *
 * This was a second address list whose only extra was Remove, reached through "Manage addresses"
 * and with no way back. Remove lives in the section now, so old links and bookmarks forward there,
 * carrying any `?returnTo=` they had.
 */
export default function CustomerAccountAddresses() {
    const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
    return (
        <Redirect href={withReturnTo('/customer/account?section=addresses', returnTo) as never} />
    );
}
