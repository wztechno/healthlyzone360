import type {
    CorporateProgrammeId,
    IsoDateTime,
    KitchenId,
    MealId,
    Money,
    OrganisationId,
    PlanDuration,
    QuotationId,
    SalesChannel,
    SubscriptionPlanId,
    VolumeTierId,
} from '@healthy360/domain-types';

import type { CursorPage, CursorPageRequest } from './pagination.ts';

/**
 * Corporate and wholesale (Prompt 2, "B2C and B2B presentation").
 *
 * **Proposed, not implemented.**
 *
 * This module is the *only* place a negotiated price is representable. That is the mechanism by
 * which the prompt's "customer screens must not expose private B2B prices" rule is enforced: a
 * consumer screen cannot leak a contract price it has no type for and no repository to fetch it
 * from. A Playwright sweep checks the rendered pages as well, but absence of the capability is the
 * part that survives a refactor.
 *
 * Detailed B2B ordering logic is explicitly out of scope. What exists here is presentation: what a
 * corporate buyer sees, and the quotation request that hands them to a human.
 */

export interface VolumeTier {
    readonly id: VolumeTierId;
    readonly minimumQuantity: number;
    readonly maximumQuantity: number | null;
    /** The negotiated unit price for this tier. Never returned to a consumer session. */
    readonly unitPrice: Money;
    readonly leadTimeDays: number;
}

export interface CorporateProgramme {
    readonly id: CorporateProgrammeId;
    readonly organisationId: OrganisationId;
    readonly name: string;
    readonly summary: string;
    readonly kitchenIds: readonly KitchenId[];
    /** Sites the programme delivers to. */
    readonly deliveryLocations: readonly string[];
    readonly headcount: number;
    /** Per-employee subsidy, when the programme carries one. */
    readonly employeeSubsidy: Money | null;
    readonly startsAt: string;
    readonly endsAt: string | null;
    readonly accountManagerName: string | null;
    readonly isActive: boolean;
}

export const CATALOGUE_ITEM_KINDS = ['meal', 'meal_plan', 'bulk_package'] as const;
export type CatalogueItemKind = (typeof CATALOGUE_ITEM_KINDS)[number];

/**
 * One line of a negotiated catalogue. `contractPrice` is `null` until the caller's session is
 * confirmed to be inside the owning organisation — an unentitled reader sees the item, not the
 * price.
 */
export interface CatalogueItem {
    readonly id: string;
    readonly programmeId: CorporateProgrammeId;
    readonly kind: CatalogueItemKind;
    readonly name: string;
    readonly description: string;
    readonly kitchenId: KitchenId;
    readonly mealId: MealId | null;
    readonly planId: SubscriptionPlanId | null;
    readonly minimumOrderQuantity: number;
    readonly volumeTiers: readonly VolumeTier[];
    readonly contractPrice: Money | null;
    readonly leadTimeDays: number;
    /** ISO weekdays the item can be delivered on. */
    readonly deliveryWeekdays: readonly number[];
    readonly channels: readonly SalesChannel[];
    readonly supportsRecurringOrder: boolean;
    readonly imagePlaceholderId: string;
}

export const QUOTATION_STATES = [
    'draft',
    'submitted',
    'in_review',
    'quoted',
    'accepted',
    'declined',
    'expired',
] as const;
export type QuotationState = (typeof QUOTATION_STATES)[number];

export interface QuotationLine {
    readonly catalogueItemId: string;
    readonly name: string;
    readonly quantity: number;
    /** `null` until the account manager has priced the line. */
    readonly quotedUnitPrice: Money | null;
    readonly quotedTotal: Money | null;
}

export interface Quotation {
    readonly id: QuotationId;
    readonly programmeId: CorporateProgrammeId;
    readonly state: QuotationState;
    readonly reference: string;
    readonly lines: readonly QuotationLine[];
    readonly requestedTotal: Money | null;
    readonly requestedDeliveryDate: string | null;
    readonly recurring: boolean;
    readonly note: string | null;
    readonly requestedAt: IsoDateTime;
    readonly respondedAt: IsoDateTime | null;
    readonly expiresAt: IsoDateTime | null;
}

export interface CatalogueFilter extends CursorPageRequest {
    readonly programmeId: CorporateProgrammeId;
    readonly query?: string | undefined;
    readonly kinds?: readonly CatalogueItemKind[] | undefined;
    readonly kitchenIds?: readonly KitchenId[] | undefined;
    readonly duration?: PlanDuration | undefined;
}

export interface RequestQuotationLine {
    readonly catalogueItemId: string;
    readonly quantity: number;
}

export interface RequestQuotationRequest {
    readonly programmeId: CorporateProgrammeId;
    readonly lines: readonly RequestQuotationLine[];
    readonly requestedDeliveryDate?: string | undefined;
    readonly recurring?: boolean | undefined;
    readonly note?: string | undefined;
    readonly contactName: string;
    readonly contactEmail: string;
}

export interface QuotationFilter extends CursorPageRequest {
    readonly programmeId?: CorporateProgrammeId | undefined;
    readonly states?: readonly QuotationState[] | undefined;
}

export interface BusinessRepository {
    /** The caller's corporate programme. Rejects with `context.organisation_required` without one. */
    getCorporateProgramme(programmeId: CorporateProgrammeId): Promise<CorporateProgramme>;

    listCatalogue(filter: CatalogueFilter): Promise<CursorPage<CatalogueItem>>;
    getCatalogueItem(itemId: string): Promise<CatalogueItem>;

    /** Submits a quotation request. No price is agreed and nothing is ordered. */
    requestQuotation(request: RequestQuotationRequest): Promise<Quotation>;
    listQuotations(filter?: QuotationFilter): Promise<CursorPage<Quotation>>;
}
