import { Redirect } from 'expo-router';

/**
 * `/customer/subscriptions` — now a section of the account page. Kept as a redirect so old links,
 * and the `resolveHref`s the server hands out, still land on the list.
 */
export default function CustomerSubscriptions() {
    return <Redirect href="/customer/account?section=subscriptions" />;
}
