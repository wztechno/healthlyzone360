import type { PriceListId } from '@healthy360/domain-types';

import type { LocalisedText, LockedRequest } from './kitchen-admin.ts';

/**
 * A kitchen's wholesale setup (B2B onboarding, slice 6).
 *
 * For a business customer to order from this kitchen, the seller side needs four things in its own
 * organisation (`ProvisionApplication`'s "Seller-side wholesale setup"): a wholesale sales channel,
 * a published agreement-scoped price list, that list assigned to the channel, and the priced
 * articles offered on the channel. These are the shapes the `/kitchen/wholesale` checklist reads
 * and writes them through.
 *
 * Deliberately **channel rows**, not the `SalesChannel` flattening `PriceListAdmin.channels` uses:
 * an assignment names one row by its id, and two rows can share a kind.
 */

/** The server's closed `channel_kind` vocabulary. */
export const SALES_CHANNEL_KINDS = [
    'b2c_web',
    'b2b',
    'pos',
    'marketplace',
    'corporate',
    'insurance',
] as const;
export type SalesChannelKind = (typeof SALES_CHANNEL_KINDS)[number];

/** The kinds a business customer orders through — what "a wholesale channel is open" means. */
export const WHOLESALE_CHANNEL_KINDS: readonly SalesChannelKind[] = [
    'b2b',
    'corporate',
    'insurance',
];

export function isWholesaleChannelKind(kind: SalesChannelKind): boolean {
    return WHOLESALE_CHANNEL_KINDS.includes(kind);
}

/** One of the organisation's own sales channel rows. */
export interface SalesChannelRecord {
    readonly id: string;
    /** Immutable after creation. */
    readonly code: string;
    readonly kind: SalesChannelKind;
    readonly name: LocalisedText;
    readonly isActive: boolean;
}

export interface CreateSalesChannelRequest {
    /** Lower-case words joined by hyphens (`wholesale`), at most 40 characters. */
    readonly code: string;
    readonly kind: SalesChannelKind;
    readonly name: LocalisedText;
}

/** `agreement` prices exactly one company's contract; `public` is a standing tariff. */
export type PriceListCustomerScope = 'public' | 'agreement';

export interface CreatePriceListRequest {
    /** Immutable after creation. */
    readonly code: string;
    readonly name: LocalisedText;
    /** ISO 4217; the server upper-cases it. */
    readonly currency: string;
    readonly customerScope: PriceListCustomerScope;
}

/** A price list's scope and the channel rows it is assigned to, in priority order. */
export interface PriceListChannels {
    readonly priceListId: PriceListId;
    /** The list's own lock version — every write in the price-list family sends it back. */
    readonly lockVersion: number;
    readonly customerScope: PriceListCustomerScope;
    readonly salesChannelIds: readonly string[];
}

/** Replaces the assignment set; the array order is the priority. */
export interface SetPriceListChannelsRequest extends LockedRequest {
    readonly salesChannelIds: readonly string[];
}

/** Which channel rows a catalogue item (product, sauce, meal, …) is offered on. */
export interface ItemChannelOffering {
    readonly itemId: string;
    readonly name: LocalisedText;
    readonly lockVersion: number;
    readonly salesChannelIds: readonly string[];
}
