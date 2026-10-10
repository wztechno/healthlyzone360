import type { ReactNode } from 'react';

import { Gate } from '../access/gate.tsx';
import { MarketplaceShell } from './marketplace-shell.tsx';

/**
 * The signed-in consumer chrome.
 *
 * It is the customer header, the same one the public marketplace wears, behind the customer gate.
 *
 * ## Why it stopped being a sidebar
 *
 * This used to be the design system's `consumer` variant — a sidebar at `lg` and above, bottom tabs
 * below it — which made the basket, the checkout and the account a different-looking site from the
 * catalogue the person had just been browsing. HealthZone draws one header across every customer
 * screen (`HealthZone Customer.dc.html`, the `<header>` above every screen branch): the brand, the
 * four destinations, search, the account button and the basket. Cart, checkout and account sit
 * under it exactly as the menu does, so the two shells became one chrome.
 *
 * The sidebar's other destinations are not lost. `consumerNavigation()` still lists every place the
 * product will have, and the signed-in home renders the ones the header does not carry as its own
 * links — so a destination returning from `availability.ts` appears there without touching a shell.
 *
 * The gate stays outside the chrome, as in `AreaShell`: a refusal must never paint a header that
 * belongs to somebody else's session.
 */
export interface ConsumerShellProps {
    readonly children: ReactNode;
    /** Skip the gate. Only used by tests that render the chrome without a session. */
    readonly unguarded?: boolean | undefined;
}

export function ConsumerShell({ children, unguarded = false }: ConsumerShellProps) {
    const shell = <MarketplaceShell>{children}</MarketplaceShell>;

    if (unguarded) return shell;

    return <Gate area="customer">{shell}</Gate>;
}
