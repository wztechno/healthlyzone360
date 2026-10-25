import type { RouteArea } from '@healthy360/domain-types';
import type { AccessState } from '@healthy360/permissions';
import { createContext, useContext } from 'react';

import { availableWorkspaceAreas } from '../../navigation/items.ts';

/**
 * The areas a shopper has. Holding one of these and nothing else, a person shops: a customer, and a
 * business buyer, who orders at their wholesale prices from the shop as well as from `/corporate`.
 */
const SHOPPER_AREAS: ReadonlySet<RouteArea> = new Set(['customer', 'corporate']);

/**
 * Whether the web shop is view-only for this person: staff — anybody who can open a workspace
 * beyond a shopper's — look at the shop to see what customers see, and buy nothing from it.
 *
 * View-only means everything a customer can *do* is gone: the basket, the account, Add, choosing
 * and setting up a plan. Everything a customer can *see* stays exactly as drawn, because seeing it
 * as drawn is the reason staff came.
 */
export function isShopViewOnly(state: AccessState): boolean {
    return availableWorkspaceAreas(state).some((option) => !SHOPPER_AREAS.has(option.area));
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
