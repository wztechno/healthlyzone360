import {
    CorporateProgrammeId,
    OrganisationId,
    QuotationId,
    isCurrencyCode,
} from '@healthy360/domain-types';
import type { CurrencyCode } from '@healthy360/domain-types';

import type {
    KitchenQuotation,
    KitchenQuotationLine,
    KitchenQuotationsRepository,
    KitchenQuotationStatus,
    QuoteKitchenQuotationRequest,
} from '../contracts/kitchen-quotations.ts';
import type {
    Quotation as WireQuotation,
    QuotationLine as WireQuotationLine,
} from '../generated/types.ts';
import type { Transport } from './transport.ts';

/**
 * The kitchen's side of B2B quotations, over the real routes under `/b2b/kitchen/quotations`.
 *
 * ## Three endpoints, and the two that answer differently
 *
 * The index answers a **bare array** in `data` (with a count in `meta` this module has no use for —
 * `items.length` is the same number and does not depend on the server having sent it); the single
 * read and `quote` answer `data.quotation`. That asymmetry is the wire's and is read literally,
 * exactly as `kitchen-orders-repository.ts` reads its own.
 *
 * ## `If-Match` on the one write, and nowhere else
 *
 * Same convention as `kitchen-admin-writes.ts` and `kitchen-orders-repository.ts`: the lock version
 * wrapped in double quotes, which is the form the server serves as `ETag` and the form its parser
 * expects. `quote` is the only write here and the contract requires `lockVersion`, so there is no
 * call shape that could forget it — `request.precondition_required` is unreachable from this module.
 * A stale one is `resource.conflict`, and nothing here retries: a silent retry with a refreshed
 * version is precisely the lost update the guard exists to prevent.
 *
 * Quoting from any state other than `submitted` is `b2b.quotation_state_invalid` rather than a
 * validation failure — the request was well formed, the world had moved.
 */

function currencyOf(code: string): CurrencyCode {
    return isCurrencyCode(code) ? code : 'USD';
}

/**
 * The wire's status, narrowed to the five a kitchen can observe.
 *
 * `draft` is unreachable here — the index filters it out and the single read answers `404` for one —
 * so it lands in the same fallback as an unrecognised value: `submitted`, which keeps the row
 * visible as an open ask rather than dropping it out of a list somebody is working.
 */
function mapStatus(status: string): KitchenQuotationStatus {
    switch (status) {
        case 'submitted':
        case 'quoted':
        case 'accepted':
        case 'declined':
        case 'expired':
            return status;
        default:
            return 'submitted';
    }
}

function mapLine(wire: WireQuotationLine): KitchenQuotationLine {
    return {
        id: wire.id,
        lineNumber: wire.line_number,
        catalogueItemId: wire.catalogue_item_id,
        catalogueItemVariantId: wire.catalogue_item_variant_id,
        quantity: wire.quantity,
        unitAmountMinor: wire.unit_amount_minor,
        lineTotalMinor: wire.line_total_minor,
        note: wire.note,
    };
}

export function mapKitchenQuotation(wire: WireQuotation): KitchenQuotation {
    return {
        id: QuotationId.unsafe(wire.id),
        buyerOrganisationId: OrganisationId.unsafe(wire.organisation_id),
        programmeId: CorporateProgrammeId.unsafe(wire.corporate_programme_id),
        reference: wire.reference,
        status: mapStatus(wire.status),
        currencyCode: currencyOf(wire.currency_code),
        notes: wire.notes,
        declineReason: wire.decline_reason,
        submittedAt: wire.submitted_at,
        quotedAt: wire.quoted_at,
        expiresAt: wire.expires_at,
        decidedAt: wire.decided_at,
        lockVersion: wire.lock_version,
        // Empty from the index by the wire's own contract; populated on the single read.
        lines: wire.lines.map(mapLine),
    };
}

/** The lock version as an entity tag, matching `kitchen-orders-repository.ts`'s `ifMatch`. */
function ifMatch(lockVersion: number): Readonly<Record<string, string>> {
    return { 'If-Match': `"${lockVersion}"` };
}

export function createApiKitchenQuotationsRepository(
    transport: Transport,
): KitchenQuotationsRepository {
    return {
        async listQuotations(): Promise<readonly KitchenQuotation[]> {
            const quotations = await transport.request<readonly WireQuotation[]>({
                method: 'GET',
                path: '/b2b/kitchen/quotations',
            });
            return quotations.map(mapKitchenQuotation);
        },

        async getQuotation(quotationId: QuotationId): Promise<KitchenQuotation> {
            const payload = await transport.request<{ readonly quotation: WireQuotation }>({
                method: 'GET',
                path: `/b2b/kitchen/quotations/${encodeURIComponent(String(quotationId))}`,
            });
            return mapKitchenQuotation(payload.quotation);
        },

        async quoteQuotation(request: QuoteKitchenQuotationRequest): Promise<KitchenQuotation> {
            const payload = await transport.request<{ readonly quotation: WireQuotation }>({
                method: 'POST',
                path: `/b2b/kitchen/quotations/${encodeURIComponent(String(request.id))}/quote`,
                headers: ifMatch(request.lockVersion),
                body: {
                    prices: request.prices.map((price) => ({
                        quotation_line_id: price.quotationLineId,
                        unit_amount_minor: price.unitAmountMinor,
                    })),
                },
            });
            return mapKitchenQuotation(payload.quotation);
        },
    };
}
