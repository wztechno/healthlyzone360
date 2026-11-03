import { Redirect } from 'expo-router';

/**
 * `/corporate/account/wind-down` — hidden for now. Every read of a wind-up is on the platform's
 * routes, so a company's own owner met a permission error here. Nothing links to the page; a typed
 * address goes to the company's home until a buyer-side read exists, and then this file renders
 * `WindDownScreen` from the active context again.
 */
export default function CorporateWindDown() {
    return <Redirect href="/corporate" />;
}
