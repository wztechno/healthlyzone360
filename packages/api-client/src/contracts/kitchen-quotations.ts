import type {
    CorporateProgrammeId,
    CurrencyCode,
    IsoDateTime,
    OrganisationId,
    QuotationId,
} from '@healthy360/domain-types';

/**
 * The kitchen's own view of the quotations submitted against it — the seller side of the same rows
 * the buyer reads through `BusinessRepository`.
 *
 * ## Why this is a separate contract rather than a filter on the buyer's shape
 *
 * The same argument `kitchen-orders.ts` makes one relationship over. `Quotation` (buyer) and
 * `KitchenQuotation` (seller) are built independently rather than one being the other plus a field,
 * because a wide shape narrowed by subtraction is how a column added next year quietly reaches the
 * wrong audience. Concretely, the seller needs two things the buyer's shape does not carry:
 *
 * 1. **`lines[].id`.** `POST …/quote` prices lines by **quotation line identifier** — one entry per
 *    line, never fewer, never more — and the buyer's `QuotationLine` has no `id` on it at all: it is
 *    keyed by `catalogueItemId`, which is the article, not the line. A screen built on the buyer's
 *    shape could read a quotation and still not be able to price it.
 * 2. **`lockVersion`.** This is the audience that **writes**. `quote` is guarded by `If-Match`, so a
 *    screen that could not read the validator could not send it.
 *
 * And it reads them per *kitchen*, reached through the programme rather than through the tenant —
 * the quotation's tenant is the **buyer** organisation, which is why the server's own locator
 * bypasses the buyer-shaped scope to answer this surface at all.
 *
 * ## `draft` is not in the status set, and that is two server guards rather than an omission
 *
 * The index excludes drafts (`status != 'draft'`) and the single read answers `404` for one. A
 * buyer's half-typed ask is not the kitchen's business, so the state a kitchen can observe starts at
 * `submitted`. The mapper folds anything it does not recognise into `submitted` rather than dropping
 * the row — an unreadable status is still an ask somebody is waiting on.
 *
 * ## The list carries no lines, and the contract says so rather than pretending
 *
 * `lines` is **always empty on `listQuotations`** — that is the wire's documented behaviour, not a
 * mapping loss: a list is a navigation aid and the lines belong on a quotation somebody deliberately
 * opened. So there is no `lineCount` here either. Inventing one would mean either a count the server
 * never sent or a second round trip per row; the detail read is the place a line count is real.
 *
 * ## Money
 *
 * Integer minor units beside the quotation's own `currencyCode`, exactly as the wire carries them
 * and exactly as `kitchen-orders.ts` does. The currency is **fixed on the quotation**, copied from
 * the agreement's active price list when the buyer opened the draft — the kitchen does not choose it
 * when pricing, which is why it sits on the quotation and not on the line.
 *
 * `unitAmountMinor` and `lineTotalMinor` are `null` until the kitchen quotes, and the absence *is*
 * the statement that no price has been named. It is not a zero: zero is a price a kitchen may
 * legitimately name, and the server accepts it.
 *
 * ## Deliberately absent in this phase
 *
 * No filters or paging on the list (the endpoint offers neither — it answers every non-draft
 * quotation, newest first), no buyer organisation name or programme name (the wire carries the
 * identifiers only; a kitchen reaching `/b2b/programmes` would be asking for the programmes it
 * *buys* through, which is not this relationship), and no decline surface — declining is the buyer's
 * move, and the kitchen only ever reads the reason they gave.
 */

/**
 * The five states a kitchen can observe. See the file header for why `draft` is not among them.
 *
 * `submitted` is the only one the kitchen may act on: `submitted → quoted` is the single transition
 * this side of the relationship owns.
 */
export const KITCHEN_QUOTATION_STATUSES = [
    'submitted',
    'quoted',
    'accepted',
    'declined',
    'expired',
] as const;
export type KitchenQuotationStatus = (typeof KITCHEN_QUOTATION_STATUSES)[number];

export interface KitchenQuotationLine {
    /** The identifier `quote` prices against. Stable; `lineNumber` is not. */
    readonly id: string;
    /** Position in the set, renumbered from 1 whenever the buyer replaced their lines. */
    readonly lineNumber: number;
    /** The article, which is one this kitchen sells. The wire carries no name for it. */
    readonly catalogueItemId: string;
    readonly catalogueItemVariantId: string | null;
    /** A decimal string at four places — `"12.0000"`. Never a float: an invoice is reconciled against it. */
    readonly quantity: string;
    /** `null` until this kitchen quotes. See the file header on why that is not a zero. */
    readonly unitAmountMinor: number | null;
    /** `quantity × unitAmountMinor`, rounded once by the server. `null` until this kitchen quotes. */
    readonly lineTotalMinor: number | null;
    /** The buyer's own note on the line — frequently the only human-readable thing on it. */
    readonly note: string | null;
}

export interface KitchenQuotation {
    readonly id: QuotationId;
    /** The **buyer** organisation. The row's tenant, which is why this surface is reached sideways. */
    readonly buyerOrganisationId: OrganisationId;
    readonly programmeId: CorporateProgrammeId;
    /** What a person reads over the phone. The only identifier on this screen worth showing. */
    readonly reference: string;
    readonly status: KitchenQuotationStatus;
    /** Fixed when the buyer opened the draft. The kitchen prices *in* it, it does not choose it. */
    readonly currencyCode: CurrencyCode;
    /** The buyer's note on the whole quotation. */
    readonly notes: string | null;
    /** Set only when the buyer declined, and only when they gave one. */
    readonly declineReason: string | null;
    readonly submittedAt: IsoDateTime | null;
    readonly quotedAt: IsoDateTime | null;
    /** Seven days after `quotedAt`. A `quoted` row past this behaves as expired before the sweep runs. */
    readonly expiresAt: IsoDateTime | null;
    /** When the buyer accepted or declined. */
    readonly decidedAt: IsoDateTime | null;
    /** The `If-Match` validator `quote` must carry. See the file header. */
    readonly lockVersion: number;
    /** **Always empty from `listQuotations`.** See the file header. */
    readonly lines: readonly KitchenQuotationLine[];
}

/** One line's price, in whole minor units of the quotation's own currency. Zero is accepted. */
export interface KitchenQuotationPrice {
    readonly quotationLineId: string;
    readonly unitAmountMinor: number;
}

export interface QuoteKitchenQuotationRequest {
    readonly id: QuotationId;
    /** The version the screen *read*. A stale one is `resource.conflict`, which is the point. */
    readonly lockVersion: number;
    /**
     * One entry for **every** line — never fewer, never more. A short set is a `validation.failed`
     * carrying the outstanding identifiers in `details.fields.prices.missing_quotation_line_ids`.
     */
    readonly prices: readonly KitchenQuotationPrice[];
}

export interface KitchenQuotationsRepository {
    /**
     * Every non-draft quotation submitted against a programme this kitchen supplies, newest first.
     *
     * No filters and no cursor: the endpoint offers neither, and a filter argument this repository
     * satisfied by sieving a full page client-side would be a promise the wire does not keep.
     */
    listQuotations(): Promise<readonly KitchenQuotation[]>;

    /** One quotation with its lines — and its `lockVersion`, which the list rows also carry. */
    getQuotation(quotationId: QuotationId): Promise<KitchenQuotation>;

    /**
     * `submitted → quoted`. Answers the fresh record carrying the next `lockVersion`.
     *
     * Any other starting state is `b2b.quotation_state_invalid`, not a validation failure: the
     * request was well formed, the world had moved.
     */
    quoteQuotation(request: QuoteKitchenQuotationRequest): Promise<KitchenQuotation>;
}
