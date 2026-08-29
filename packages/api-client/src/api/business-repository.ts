import {
    CorporateProgrammeId,
    KitchenId,
    MealId,
    OrganisationId,
    QuotationId,
    SubscriptionPlanId,
    isCurrencyCode,
} from '@healthy360/domain-types';
import type { Money } from '@healthy360/domain-types';

import type {
    BusinessRepository,
    CatalogueFilter,
    CatalogueItem,
    CatalogueItemKind,
    CorporateProgramme,
    Quotation,
    QuotationFilter,
    QuotationLine,
    QuotationState,
    RequestQuotationRequest,
} from '../contracts/business.ts';
import type { CursorPage } from '../contracts/pagination.ts';
import { emptyPage } from '../contracts/pagination.ts';
import { pathSegment } from './marketplace-mappers.ts';
import type { Transport } from './transport.ts';

/**
 * Corporate programmes, negotiated catalogues and quotations, over HTTP.
 *
 * Catalogue reads stay on `GET /b2b/catalogue/items`. Programmes and quotations
 * use `/b2b/programmes…` and `/b2b/quotations…` (B1–B8). Fields the wire does
 * not carry (headcount, subsidy, volume tiers, contact name) are honest empties
 * rather than invented figures — the same rule the catalogue mapper already
 * applies.
 */

export type ApiBusinessRepository = BusinessRepository;

interface WireProgramme {
    readonly id: string;
    readonly organisation_id: string;
    readonly kitchen_organisation_id: string;
    readonly b2b_agreement_id: string;
    readonly code: string;
    readonly name_en: string;
    readonly name_ar: string;
    readonly description: string | null;
    readonly status: string;
    readonly created_at: string | null;
    readonly updated_at: string | null;
}

interface WireQuotationLine {
    readonly id: string;
    readonly line_number: number;
    readonly catalogue_item_id: string;
    readonly catalogue_item_variant_id: string | null;
    readonly quantity: string;
    readonly unit_amount_minor: number | null;
    readonly line_total_minor: number | null;
    readonly note: string | null;
}

interface WireQuotation {
    readonly id: string;
    readonly organisation_id: string;
    readonly corporate_programme_id: string;
    readonly reference: string;
    readonly status: string;
    readonly currency_code: string;
    readonly notes: string | null;
    readonly decline_reason: string | null;
    readonly submitted_at: string | null;
    readonly quoted_at: string | null;
    readonly expires_at: string | null;
    readonly decided_at: string | null;
    readonly lock_version: number;
    readonly lines: readonly WireQuotationLine[];
    readonly created_at: string | null;
    readonly updated_at: string | null;
}

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

function ifMatch(lockVersion: number): Record<string, string> {
    return { 'If-Match': `"${lockVersion}"` };
}

function mapItemKind(itemType: string): CatalogueItemKind {
    switch (itemType) {
        case 'subscription_plan':
            return 'meal_plan';
        case 'product':
        case 'sauce':
        case 'dressing':
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
            wire.price === null ? null : money(wire.price.amount_minor, wire.price.currency_code),
        leadTimeDays: 0,
        deliveryWeekdays: [],
        channels: ['b2b'],
        supportsRecurringOrder: false,
        imagePlaceholderId: '',
    };
}

function mapProgramme(wire: WireProgramme): CorporateProgramme {
    return {
        id: CorporateProgrammeId.unsafe(wire.id),
        organisationId: OrganisationId.unsafe(wire.organisation_id),
        name: wire.name_en,
        summary: wire.description ?? '',
        kitchenIds: [KitchenId.unsafe(wire.kitchen_organisation_id)],
        deliveryLocations: [],
        headcount: 0,
        employeeSubsidy: null,
        startsAt: wire.created_at ?? '',
        endsAt: null,
        accountManagerName: null,
        isActive: wire.status === 'active',
    };
}

function mapQuotationState(status: string): QuotationState {
    switch (status) {
        case 'draft':
        case 'submitted':
        case 'quoted':
        case 'accepted':
        case 'declined':
        case 'expired':
            return status;
        default:
            // Wire has no `in_review`; treat unknowns as submitted so the buyer
            // still sees an open ask rather than a silent drop.
            return 'submitted';
    }
}

function mapQuotationLine(wire: WireQuotationLine, currency: string): QuotationLine {
    const unit = wire.unit_amount_minor === null ? null : money(wire.unit_amount_minor, currency);
    const total = wire.line_total_minor === null ? null : money(wire.line_total_minor, currency);

    return {
        catalogueItemId: wire.catalogue_item_id,
        name: wire.note ?? wire.catalogue_item_id,
        quantity: Number.parseFloat(wire.quantity) || 0,
        quotedUnitPrice: unit,
        quotedTotal: total,
    };
}

function mapQuotation(wire: WireQuotation): Quotation {
    const lines = wire.lines.map((line) => mapQuotationLine(line, wire.currency_code));
    const priced = lines.every((line) => line.quotedTotal !== null);
    const requestedTotal =
        priced && lines.length > 0
            ? lines.reduce<Money | null>(
                  (sum, line) => {
                      if (sum === null || line.quotedTotal === null) return sum;
                      if (sum.currency !== line.quotedTotal.currency) return null;
                      return {
                          amount: sum.amount + line.quotedTotal.amount,
                          currency: sum.currency,
                      };
                  },
                  { amount: 0, currency: wire.currency_code as Money['currency'] },
              )
            : null;

    return {
        id: QuotationId.unsafe(wire.id),
        programmeId: CorporateProgrammeId.unsafe(wire.corporate_programme_id),
        state: mapQuotationState(wire.status),
        reference: wire.reference,
        lines,
        requestedTotal,
        requestedDeliveryDate: null,
        recurring: false,
        note: wire.notes,
        requestedAt: (wire.submitted_at ?? wire.created_at ?? '') as Quotation['requestedAt'],
        respondedAt:
            wire.quoted_at === null && wire.decided_at === null
                ? null
                : ((wire.quoted_at ?? wire.decided_at ?? '') as Quotation['respondedAt']),
        expiresAt: wire.expires_at === null ? null : (wire.expires_at as Quotation['expiresAt']),
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
    filter: { readonly limit?: number | undefined; readonly cursor?: string | undefined },
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

export function createApiBusinessRepository(transport: Transport): ApiBusinessRepository {
    async function fetchCatalogueIndex(): Promise<readonly WireB2bCatalogueItem[]> {
        const payload = await transport.request<WireB2bCatalogueIndex>({
            method: 'GET',
            path: '/b2b/catalogue/items',
        });
        return payload.items;
    }

    async function fetchCatalogueOne(itemId: string): Promise<WireB2bCatalogueItem> {
        const payload = await transport.request<WireB2bCatalogueShow>({
            method: 'GET',
            path: `/b2b/catalogue/items/${pathSegment(itemId)}`,
        });
        return payload.item;
    }

    async function fetchProgrammes(): Promise<readonly WireProgramme[]> {
        return transport.request<readonly WireProgramme[]>({
            method: 'GET',
            path: '/b2b/programmes',
        });
    }

    async function fetchProgrammeQuotations(
        programmeId: CorporateProgrammeId,
    ): Promise<readonly WireQuotation[]> {
        return transport.request<readonly WireQuotation[]>({
            method: 'GET',
            path: `/b2b/programmes/${pathSegment(String(programmeId))}/quotations`,
        });
    }

    async function fetchQuotation(quotationId: string): Promise<WireQuotation> {
        const payload = await transport.request<{ readonly quotation: WireQuotation }>({
            method: 'GET',
            path: `/b2b/quotations/${pathSegment(quotationId)}`,
        });
        return payload.quotation;
    }

    return {
        async listCorporateProgrammes(): Promise<readonly CorporateProgramme[]> {
            const programmes = await fetchProgrammes();
            return programmes.map(mapProgramme);
        },

        async getCorporateProgramme(
            programmeId: CorporateProgrammeId,
        ): Promise<CorporateProgramme> {
            const payload = await transport.request<{ readonly programme: WireProgramme }>({
                method: 'GET',
                path: `/b2b/programmes/${pathSegment(String(programmeId))}`,
            });
            return mapProgramme(payload.programme);
        },

        async listCatalogue(filter: CatalogueFilter): Promise<CursorPage<CatalogueItem>> {
            const wireItems = await fetchCatalogueIndex();
            const mapped = wireItems.map((wire) => mapCatalogueItem(wire, filter.programmeId));
            const matched = mapped.filter((item) => matchesCatalogueFilter(item, filter));

            if (matched.length === 0) return emptyPage();

            return paginateClient(matched, filter);
        },

        async getCatalogueItem(itemId: string): Promise<CatalogueItem> {
            const wire = await fetchCatalogueOne(itemId);
            return mapCatalogueItem(wire, CorporateProgrammeId.unsafe('b2b-catalogue'));
        },

        async requestQuotation(request: RequestQuotationRequest): Promise<Quotation> {
            const notes = [
                request.note?.trim() || null,
                `Contact: ${request.contactName} <${request.contactEmail}>`,
                request.requestedDeliveryDate === undefined
                    ? null
                    : `Requested delivery: ${request.requestedDeliveryDate}`,
                request.recurring === true ? 'Recurring: yes' : null,
            ]
                .filter((part): part is string => part !== null && part !== '')
                .join('\n');

            const created = await transport.request<{ readonly quotation: WireQuotation }>({
                method: 'POST',
                path: `/b2b/programmes/${pathSegment(String(request.programmeId))}/quotations`,
                body: {
                    notes: notes === '' ? null : notes,
                    lines: request.lines.map((line) => ({
                        catalogue_item_id: line.catalogueItemId,
                        quantity: line.quantity,
                    })),
                },
            });

            const submitted = await transport.request<{ readonly quotation: WireQuotation }>({
                method: 'POST',
                path: `/b2b/quotations/${pathSegment(created.quotation.id)}/submit`,
                headers: ifMatch(created.quotation.lock_version),
            });

            // List shape omits lines; re-read so the mutation returns priced-ready lines.
            try {
                const full = await fetchQuotation(submitted.quotation.id);
                return mapQuotation(full);
            } catch {
                return mapQuotation(submitted.quotation);
            }
        },

        async listQuotations(filter?: QuotationFilter): Promise<CursorPage<Quotation>> {
            let programmeIds: CorporateProgrammeId[];

            if (filter?.programmeId !== undefined) {
                programmeIds = [filter.programmeId];
            } else {
                const programmes = await fetchProgrammes();
                programmeIds = programmes.map((programme) =>
                    CorporateProgrammeId.unsafe(programme.id),
                );
            }

            const pages = await Promise.all(
                programmeIds.map(async (programmeId) => {
                    const wires = await fetchProgrammeQuotations(programmeId);
                    // Index omits lines; hydrate when the caller may need them.
                    return Promise.all(
                        wires.map(async (wire) => {
                            if (wire.lines.length > 0) return mapQuotation(wire);
                            try {
                                return mapQuotation(await fetchQuotation(wire.id));
                            } catch {
                                return mapQuotation(wire);
                            }
                        }),
                    );
                }),
            );

            let items = pages.flat();

            if (filter?.states !== undefined && filter.states.length > 0) {
                const allowed = new Set(filter.states);
                items = items.filter((quotation) => allowed.has(quotation.state));
            }

            items = [...items].sort((left, right) =>
                right.requestedAt.localeCompare(left.requestedAt),
            );

            return paginateClient(items, filter ?? {});
        },

        async acceptQuotation(quotationId: QuotationId): Promise<Quotation> {
            const current = await fetchQuotation(String(quotationId));
            const accepted = await transport.request<{ readonly quotation: WireQuotation }>({
                method: 'POST',
                path: `/b2b/quotations/${pathSegment(String(quotationId))}/accept`,
                headers: ifMatch(current.lock_version),
            });
            return mapQuotation(accepted.quotation);
        },

        async declineQuotation(quotationId: QuotationId, reason?: string): Promise<Quotation> {
            const current = await fetchQuotation(String(quotationId));
            const declined = await transport.request<{ readonly quotation: WireQuotation }>({
                method: 'POST',
                path: `/b2b/quotations/${pathSegment(String(quotationId))}/decline`,
                headers: ifMatch(current.lock_version),
                body: reason === undefined || reason.trim() === '' ? {} : { reason: reason.trim() },
            });
            return mapQuotation(declined.quotation);
        },
    };
}

/** @deprecated Prefer {@link createApiBusinessRepository}. */
export function createApiBusinessReads(
    transport: Transport,
): Pick<BusinessRepository, 'listCatalogue' | 'getCatalogueItem'> {
    const full = createApiBusinessRepository(transport);
    return {
        listCatalogue: full.listCatalogue.bind(full),
        getCatalogueItem: full.getCatalogueItem.bind(full),
    };
}
