import {
    CorporateProgrammeId,
    KitchenId,
    MealId,
    SubscriptionPlanId,
    isCurrencyCode,
} from '@healthy360/domain-types';
import type { Money } from '@healthy360/domain-types';

import type {
    BusinessRepository,
    CatalogueFilter,
    CatalogueItem,
    CatalogueItemKind,
} from '../contracts/business.ts';
import type { CursorPage } from '../contracts/pagination.ts';
import { emptyPage } from '../contracts/pagination.ts';
import { pathSegment } from './marketplace-mappers.ts';
import type { Transport } from './transport.ts';

/**
 * Corporate catalogue reads, over HTTP.
 *
 * `GET /b2b/catalogue/items` and `GET /b2b/catalogue/items/{item}` return the articles a corporate
 * buyer may purchase on channels covered by their agreement, with the negotiated price already
 * resolved. Programme metadata and quotation workflows remain on the prototype stubs.
 *
 * The wire row is thinner than `CatalogueItem`: no programme, no volume tiers, no lead time. Fields
 * the endpoint does not carry are filled with honest empties rather than invented figures.
 */

export type ApiBusinessReads = Pick<BusinessRepository, 'listCatalogue' | 'getCatalogueItem'>;

interface WireB2bCatalogueItem {
    readonly id: string;
    readonly name: string;
    readonly item_type: string;
    readonly seller_organisation_id: string;
    readonly sales_channel_id: string;
    readonly price: { readonly amount_minor: number; readonly currency_code: string } | null;
}

interface WireB2bCatalogueIndex {
    readonly items: readonly WireB2bCatalogueItem[];
}

interface WireB2bCatalogueShow {
    readonly item: WireB2bCatalogueItem;
}

function money(amountMinor: number, currency: string): Money | null {
    if (!isCurrencyCode(currency)) return null;
    return { amount: amountMinor, currency };
}

function mapItemKind(itemType: string): CatalogueItemKind {
    switch (itemType) {
        case 'subscription_plan':
            return 'meal_plan';
        case 'product':
            return 'bulk_package';
        default:
            return 'meal';
    }
}

function mapCatalogueItem(
    wire: WireB2bCatalogueItem,
    programmeId: CorporateProgrammeId,
): CatalogueItem {
    const kind = mapItemKind(wire.item_type);

    return {
        id: wire.id,
        programmeId,
        kind,
        name: wire.name,
        description: '',
        kitchenId: KitchenId.unsafe(wire.seller_organisation_id),
        mealId: kind === 'meal' ? MealId.unsafe(wire.id) : null,
        planId: kind === 'meal_plan' ? SubscriptionPlanId.unsafe(wire.id) : null,
        minimumOrderQuantity: 1,
        volumeTiers: [],
        contractPrice:
            wire.price === null
                ? null
                : money(wire.price.amount_minor, wire.price.currency_code),
        leadTimeDays: 0,
        deliveryWeekdays: [],
        channels: ['b2b'],
        supportsRecurringOrder: false,
        imagePlaceholderId: '',
    };
}

function matchesCatalogueFilter(item: CatalogueItem, filter: CatalogueFilter): boolean {
    if (filter.query !== undefined && filter.query.trim() !== '') {
        const needle = filter.query.trim().toLowerCase();
        const haystack = `${item.name} ${item.description}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
    }

    if (
        filter.kinds !== undefined &&
        filter.kinds.length > 0 &&
        !filter.kinds.includes(item.kind)
    ) {
        return false;
    }

    if (
        filter.kitchenIds !== undefined &&
        filter.kitchenIds.length > 0 &&
        !filter.kitchenIds.includes(item.kitchenId)
    ) {
        return false;
    }

    return true;
}

function paginateClient<T>(
    items: readonly T[],
    filter: CatalogueFilter,
): CursorPage<T> {
    const limit = filter.limit ?? items.length;
    const offset = filter.cursor === undefined ? 0 : Number.parseInt(filter.cursor, 10) || 0;
    const slice = items.slice(offset, offset + limit);
    const nextOffset = offset + slice.length;

    return {
        items: slice,
        nextCursor: nextOffset < items.length ? String(nextOffset) : null,
        hasMore: nextOffset < items.length,
        totalCount: items.length,
    };
}

export function createApiBusinessReads(transport: Transport): ApiBusinessReads {
    async function fetchIndex(): Promise<readonly WireB2bCatalogueItem[]> {
        const payload = await transport.request<WireB2bCatalogueIndex>({
            method: 'GET',
            path: '/b2b/catalogue/items',
        });
        return payload.items;
    }

    async function fetchOne(itemId: string): Promise<WireB2bCatalogueItem> {
        const payload = await transport.request<WireB2bCatalogueShow>({
            method: 'GET',
            path: `/b2b/catalogue/items/${pathSegment(itemId)}`,
        });
        return payload.item;
    }

    return {
        async listCatalogue(filter: CatalogueFilter): Promise<CursorPage<CatalogueItem>> {
            const wireItems = await fetchIndex();
            const mapped = wireItems.map((wire) => mapCatalogueItem(wire, filter.programmeId));
            const matched = mapped.filter((item) => matchesCatalogueFilter(item, filter));

            if (matched.length === 0) return emptyPage();

            return paginateClient(matched, filter);
        },

        async getCatalogueItem(itemId: string): Promise<CatalogueItem> {
            const wire = await fetchOne(itemId);
            // Programme is a presentation scope the wire does not carry. Callers on the item
            // screen already know which programme they arrived from; until programmes are served,
            // a stable placeholder keeps navigation working.
            return mapCatalogueItem(wire, CorporateProgrammeId.unsafe('b2b-catalogue'));
        },
    };
}
