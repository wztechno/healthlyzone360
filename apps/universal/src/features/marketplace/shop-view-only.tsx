import type { RouteArea } from '@healthy360/domain-types';
import type { AccessState } from '@healthy360/permissions';
import { createContext, useContext } from 'react';

import { availableWorkspaceAreas } from '../../navigation/items.ts';

/** The one area a shopper has. Holding it and nothing else, a person shops. */
const SHOPPER_AREAS: ReadonlySet<RouteArea> = new Set(['customer']);

/**
 * Whether the web shop is view-only for this person: anybody who belongs to an organisation, or
 * can open a workspace beyond a shopper's, looks at the shop and buys nothing from it.
 *
 * - **Staff** look at the shop to see what customers see.
 * - **Business buyers** — a member of a corporate customer — browse it read-only too. They order
 *   at their wholesale prices from `/corporate`, whose checkout (`/customer/checkout?channel=
 *   wholesale`) is the one customer page they keep (`app/customer/_layout.tsx`).
 *
 * Any active membership counts, before an organisation is chosen as much as after: the server
 * refuses retail trading to the same people (`CartLocator::assertShopperMayUseChannel`), so an Add
 * offered here would only ever fail.
 *
 * View-only means everything a customer can *do* is gone: the basket, the account, Add, choosing
 * and setting up a plan. Everything a customer can *see* stays exactly as drawn, because seeing it
 * as drawn is the reason they came.
 */
export function isShopViewOnly(state: AccessState): boolean {
    return (
        state.hasActiveMembership ||
        availableWorkspaceAreas(state).some((option) => !SHOPPER_AREAS.has(option.area))
    );
}

/**
 * Carried by the shop's chrome (`MarketplaceShell`), so a card deep in a page can drop its Add
 * without every screen threading a flag through. `false` outside the shop — and in a card's own
 * test, which renders it without the chrome.
 */
const ShopViewOnlyContext = createContext(false);

export const ShopViewOnlyProvider = ShopViewOnlyContext.Provider;

export function useShopViewOnly(): boolean {
    return useContext(ShopViewOnlyContext);
}
