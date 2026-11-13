import { PriceListId } from '@healthy360/domain-types';

import type { KitchenAdminRepository, PriceListAdmin } from '../contracts/kitchen-admin.ts';
import type {
    CreatePriceListRequest,
    CreateSalesChannelRequest,
    ItemChannelOffering,
    PriceListChannels,
    SalesChannelRecord,
    SetPriceListChannelsRequest,
} from '../contracts/kitchen-wholesale.ts';
import type {
    AdminCatalogueItemIndexRow,
    AdminChannelAssignment,
    AdminPriceList,
    AdminPriceListIndexRow,
    AdminSalesChannel,
    PriceListChannelAssignment,
} from '../generated/types.ts';
import { mapPriceListAdmin } from './kitchen-admin-mappers.ts';
import type { Transport } from './transport.ts';

/**
 * The wholesale setup's reads and writes (B2B onboarding, slice 6) — the four seller-side records a
 * business customer's order needs, over endpoints that already existed without a client.
 *
 * Every read here goes to the server. The catalogue reads cache the channel vocabulary for the
 * session, which is right for mapping and wrong for a page whose whole job is to create a channel
 * and then show it.
 */
export type ApiKitchenAdminWholesale = Pick<
    KitchenAdminRepository,
    | 'listSalesChannels'
    | 'createSalesChannel'
    | 'createPriceList'
    | 'getPriceListChannels'
    | 'listPriceListChannels'
    | 'listItemChannelOfferings'
    | 'setPriceListChannels'
    | 'getItemChannelOffering'
    | 'offerItemOnChannel'
>;

function ifMatch(lockVersion: number): Readonly<Record<string, string>> {
    return { 'If-Match': `"${lockVersion}"` };
}

export function mapSalesChannelRecord(wire: AdminSalesChannel): SalesChannelRecord {
    return {
        id: wire.id,
        code: wire.code,
        kind: wire.channel_kind,
        name: { en: wire.name_en, ar: wire.name_ar },
        isActive: wire.status === 'active',
    };
}

function mapPriceListChannels(data: {
    readonly price_list: AdminPriceList;
    readonly channels: readonly PriceListChannelAssignment[];
}): PriceListChannels {
    return {
        priceListId: PriceListId.unsafe(data.price_list.id),
        lockVersion: data.price_list.lock_version,
        customerScope: data.price_list.customer_scope,
        salesChannelIds: [...data.channels]
            .sort((left, right) => left.priority - right.priority)
            .map((row) => row.sales_channel_id),
    };
}

interface ItemChannelsPayload {
    readonly item: {
        readonly id: string;
        readonly lock_version: number;
        readonly name_en: string;
        readonly name_ar: string;
    };
    readonly channels: readonly AdminChannelAssignment[];
}

function mapItemChannelOffering(data: ItemChannelsPayload): ItemChannelOffering {
    return {
        itemId: data.item.id,
        name: { en: data.item.name_en, ar: data.item.name_ar },
        lockVersion: data.item.lock_version,
        salesChannelIds: [...new Set(data.channels.map((row) => row.sales_channel_id))],
    };
}

export function createApiKitchenAdminWholesale(transport: Transport): ApiKitchenAdminWholesale {
    const readItemChannels = (itemId: string) =>
        transport.request<ItemChannelsPayload>({
            method: 'GET',
            path: `/catalogue/items/${encodeURIComponent(itemId)}`,
        });

    return {
        async listSalesChannels() {
            const rows = await transport.request<AdminSalesChannel[]>({
                method: 'GET',
                path: '/catalogue/sales-channels',
            });
            return rows.map(mapSalesChannelRecord);
        },

        async createSalesChannel(request: CreateSalesChannelRequest) {
            const data = await transport.request<{ readonly sales_channel: AdminSalesChannel }>({
                method: 'POST',
                path: '/catalogue/sales-channels',
                body: {
                    code: request.code,
                    channel_kind: request.kind,
                    name_en: request.name.en,
                    name_ar: request.name.ar.trim() === '' ? null : request.name.ar,
                },
            });
            return mapSalesChannelRecord(data.sales_channel);
        },

        async createPriceList(request: CreatePriceListRequest): Promise<PriceListAdmin> {
            const data = await transport.request<{ readonly price_list: AdminPriceList }>({
                method: 'POST',
                path: '/catalogue/price-lists',
                body: {
                    code: request.code,
                    name_en: request.name.en,
                    name_ar: request.name.ar.trim() === '' ? null : request.name.ar,
                    currency_code: request.currency.trim().toUpperCase(),
                    customer_scope: request.customerScope,
                },
            });
            // New: no entries, and no channel until one is assigned.
            return mapPriceListAdmin(data.price_list, { channels: [], entries: [] });
        },

        async getPriceListChannels(priceListId: PriceListId) {
            const data = await transport.request<{
                readonly price_list: AdminPriceList;
                readonly channels: PriceListChannelAssignment[];
            }>({
                method: 'GET',
                path: `/catalogue/price-lists/${encodeURIComponent(String(priceListId))}`,
            });
            return mapPriceListChannels(data);
        },

        async setPriceListChannels(priceListId: PriceListId, request: SetPriceListChannelsRequest) {
            const data = await transport.request<{
                readonly price_list: AdminPriceList;
                readonly channels: PriceListChannelAssignment[];
            }>({
                method: 'PUT',
                path: `/catalogue/price-lists/${encodeURIComponent(String(priceListId))}/channels`,
                headers: ifMatch(request.lockVersion),
                body: {
                    channels: request.salesChannelIds.map((id, index) => ({
                        sales_channel_id: id,
                        priority: index,
                    })),
                },
            });
            return mapPriceListChannels(data);
        },

        async listPriceListChannels() {
            // One request per hundred lists, channels included; a kitchen has a handful.
            const lists: PriceListChannels[] = [];
            let cursor: string | undefined;
            do {
                const search = new URLSearchParams({ include: 'channels', limit: '100' });
                if (cursor !== undefined) search.set('cursor', cursor);
                const envelope = await transport.requestEnvelope<AdminPriceListIndexRow[]>({
                    method: 'GET',
                    path: `/catalogue/price-lists?${search.toString()}`,
                });
                for (const row of envelope.data) {
                    lists.push(
                        mapPriceListChannels({ price_list: row, channels: row.channels ?? [] }),
                    );
                }
                const meta = envelope.meta as { has_more?: boolean; next_cursor?: string | null };
                cursor =
                    meta.has_more === true && typeof meta.next_cursor === 'string'
                        ? meta.next_cursor
                        : undefined;
            } while (cursor !== undefined);
            return lists;
        },

        async listItemChannelOfferings(itemIds: readonly string[]) {
            const offerings: ItemChannelOffering[] = [];
            for (let start = 0; start < itemIds.length; start += 100) {
                const chunk = itemIds.slice(start, start + 100);
                const search = new URLSearchParams({
                    ids: chunk.join(','),
                    include: 'channels',
                    limit: '100',
                });
                const rows = await transport.request<AdminCatalogueItemIndexRow[]>({
                    method: 'GET',
                    path: `/catalogue/items?${search.toString()}`,
                });
                for (const row of rows) {
                    offerings.push(
                        mapItemChannelOffering({ item: row, channels: row.channels ?? [] }),
                    );
                }
            }
            return offerings;
        },

        async getItemChannelOffering(itemId: string) {
            return mapItemChannelOffering(await readItemChannels(itemId));
        },

        async offerItemOnChannel(itemId: string, salesChannelId: string) {
            const current = await readItemChannels(itemId);
            if (current.channels.some((row) => row.sales_channel_id === salesChannelId)) {
                return mapItemChannelOffering(current);
            }

            // The write replaces the set: every row the item already has goes back as it was.
            const data = await transport.request<ItemChannelsPayload>({
                method: 'PUT',
                path: `/catalogue/items/${encodeURIComponent(itemId)}/channels`,
                headers: ifMatch(current.item.lock_version),
                body: {
                    channels: [
                        ...current.channels.map((row) => ({
                            sales_channel_id: row.sales_channel_id,
                            catalogue_item_variant_id: row.catalogue_item_variant_id,
                            is_available: row.is_available,
                            available_from: row.available_from,
                            available_to: row.available_to,
                        })),
                        { sales_channel_id: salesChannelId, is_available: true },
                    ],
                },
            });
            return mapItemChannelOffering(data);
        },
    };
}
