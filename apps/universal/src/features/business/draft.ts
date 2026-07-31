import type { CatalogueItem, RequestQuotationLine } from '@healthy360/api-client/contracts';
import type { Money } from '@healthy360/domain-types';
import type { Translate } from '@healthy360/validation';

import { lineValue } from './format.ts';

/**
 * The quotation draft: local state, validated locally, submitted whole.
 *
 * ## Why the draft is local state rather than a stored resource
 *
 * `QUOTATION_STATES` includes `draft`, so the *domain* has the concept — but `BusinessRepository`
 * publishes no way to create one, add a line to one, or amend one. The only write is
 * `requestQuotation`, which submits a complete request in a single call. So the draft lives in the
 * screen until it is submitted, and this module holds the arithmetic and the rules so both are
 * testable without rendering anything.
 *
 * That is a real contract gap and it has a real consequence: a half-composed quotation is lost on
 * reload, and two people in the same organisation cannot compose one together. A backend should
 * publish `POST /api/v1/business/quotations` (draft), `PATCH .../{quotation}/lines` and
 * `POST .../{quotation}/submit`; the wave report records it.
 *
 * ## The minimum order quantity is checked here *and* server-side
 *
 * The store rejects a line below its minimum with a sentence naming the item
 * (`mock/prototype/store.ts`), and that rejection is rendered rather than swallowed. Checking here
 * as well is not duplication for its own sake: it lets the interface disable submission and explain
 * the rule *before* somebody fills a form in, which is the difference between a constraint and a
 * refusal.
 */

/** Quantity per catalogue line. `null` is "not ordered", which is distinct from a typed zero. */
export type DraftQuantities = Readonly<Record<string, number | null>>;

export interface DraftContact {
    readonly name: string;
    readonly email: string;
    readonly note: string;
    readonly requestedDeliveryDate: string | null;
    readonly recurring: boolean;
}

export const EMPTY_CONTACT: DraftContact = {
    name: '',
    email: '',
    note: '',
    requestedDeliveryDate: null,
    recurring: false,
};

/** Fields the builder can report an error against. */
export const DRAFT_FIELDS = ['lines', 'name', 'email'] as const;
export type DraftField = (typeof DRAFT_FIELDS)[number];

/** Lines with a positive quantity, in catalogue order so the request is deterministic. */
export function draftLines(
    items: readonly CatalogueItem[],
    quantities: DraftQuantities,
): readonly RequestQuotationLine[] {
    return items
        .map((item) => ({ catalogueItemId: item.id, quantity: quantities[item.id] ?? 0 }))
        .filter((line) => line.quantity > 0);
}

/** Lines whose quantity is positive but below the item's minimum order. */
export function linesBelowMinimum(
    items: readonly CatalogueItem[],
    quantities: DraftQuantities,
): readonly CatalogueItem[] {
    return items.filter((item) => {
        const quantity = quantities[item.id] ?? 0;
        return quantity > 0 && quantity < item.minimumOrderQuantity;
    });
}

/**
 * What the draft is worth, per currency.
 *
 * A list rather than a total, and a list that may be empty: a line whose quantity earns no tier has
 * no price at all, and the screen says so rather than quoting the base rate the volume does not
 * entitle the buyer to (`./format.ts`).
 */
export function draftValues(
    items: readonly CatalogueItem[],
    quantities: DraftQuantities,
): readonly Money[] {
    return items
        .map((item) => lineValue(item, quantities[item.id] ?? 0))
        .filter((value): value is Money => value !== null);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Everything wrong with the draft, by field.
 *
 * Returns an object rather than throwing so the screen can render every problem at once; a form that
 * reveals its objections one at a time is a form people fill in twice.
 */
export function validateDraft(
    items: readonly CatalogueItem[],
    quantities: DraftQuantities,
    contact: DraftContact,
    translate: Translate,
): Readonly<Partial<Record<DraftField, string>>> {
    const errors: Partial<Record<DraftField, string>> = {};

    const lines = draftLines(items, quantities);
    const below = linesBelowMinimum(items, quantities);

    if (lines.length === 0) {
        errors.lines = translate('business:builder.errorNoLines');
    } else if (below.length > 0) {
        errors.lines = translate('business:builder.errorBelowMinimum', {
            names: below.map((item) => item.name).join(', '),
        });
    }

    if (contact.name.trim() === '') {
        errors.name = translate('errors:validation.required');
    }
    if (contact.email.trim() === '') {
        errors.email = translate('errors:validation.required');
    } else if (!EMAIL.test(contact.email.trim())) {
        errors.email = translate('errors:validation.email');
    }

    return errors;
}
