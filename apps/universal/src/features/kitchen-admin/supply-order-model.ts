import type { OrderProposalItem, SupplierOption } from '@healthy360/api-client/contracts';
import type { BranchId, StockItemId, SupplierId } from '@healthy360/domain-types';

/**
 * The supply-order builder's arithmetic and grouping, with no React in it (SUP3).
 *
 * Tested apart from the screen deliberately, for the reason the sale wizard's models are: every
 * rule here is either **a refusal the server would otherwise return** — a negative quantity, five
 * decimal places on a `decimal(14,4)` column — or **a decision about what a person is about to buy**,
 * and a rule proved only through a rendered component is one that gets quietly lost the next time
 * the layout changes.
 *
 * ## Blank is not an error
 *
 * The single most consequential distinction in this file. A proposal row whose par could not be
 * computed arrives with `suggestedQuantity: null`, so the builder opens with an **empty box** on
 * every such row — that is the designed state, not a mistake. A blank or a zero therefore means
 * *not ordering this one*, and the row is excluded quietly with a count in the summary. A negative
 * number, a fifth decimal place or a word typed into the box is a different thing entirely: the
 * person meant something and it cannot be honoured, so it is an error against that row.
 *
 * Painting every empty box red on a queue of forty shelves would make the screen unusable at the
 * exact moment it is most needed.
 *
 * ## Quantities stay strings
 *
 * Parsed for *validity*, never converted for storage. `parseFloat('0.1') + parseFloat('0.2')` is
 * the reason: a kitchen ordering 0.125 kg must get 0.125 on the sheet, and a float round-trip is
 * how it becomes 0.12499999999999999. The value that reaches {@link toBatchPayload} is the trimmed
 * text the person typed, proved to be a decimal the server's column can hold.
 *
 * ## Server order is preserved, everywhere
 *
 * Rows arrive out of stock first, then low, then requested, each group by item name. Groups come
 * out in the order their first line appears in that list, and lines within a group keep it too. The
 * builder never sorts, and neither does this: the print sheet in a later slice reads this grouping,
 * and a person who worked the list top to bottom must recognise the document that comes out of it.
 *
 * ## The seam to slice 4
 *
 * {@link toBatchPayload} exists now, and it is the whole reason grouping is a pure function rather
 * than JSX. Slice 4 adds a commit bar whose one job is to hand this object to the batch-create
 * endpoint; nothing in this file has to change for that, and the preview a person confirms is
 * literally the request that gets sent.
 */

/** The most a `decimal(14,4)` column can hold, exclusive — ten integer digits. */
const MAX_QUANTITY = 1e10;

/** Stock precision. A fifth decimal place would be silently truncated by the column. */
const MAX_DECIMALS = 4;

/** Anything that is not a plain unsigned-or-signed decimal literal. No exponents, no thousands. */
const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * Why a typed quantity cannot be ordered.
 *
 * The first two are **not errors** — see the file header. The rest are.
 */
export type QuantityIssue =
    'blank' | 'zero' | 'negative' | 'notANumber' | 'tooPrecise' | 'tooLarge';

export interface QuantityReading {
    /** The orderable decimal string, or `null` when this row contributes no line. */
    readonly value: string | null;
    readonly issue: QuantityIssue | null;
    /** `true` only for an issue worth painting red. Blank and zero are exclusions, not mistakes. */
    readonly isError: boolean;
}

/**
 * Read one quantity box.
 *
 * Order of checks matters: shape before sign before precision before magnitude, so `-1.234567`
 * reports `negative` (the thing the person most needs to know) rather than `tooPrecise`.
 */
export function readQuantity(raw: string): QuantityReading {
    const trimmed = raw.trim();

    if (trimmed === '') {
        return { value: null, issue: 'blank', isError: false };
    }

    if (!DECIMAL_PATTERN.test(trimmed)) {
        return { value: null, issue: 'notANumber', isError: true };
    }

    const parsed = Number(trimmed);

    if (Number.isNaN(parsed)) {
        return { value: null, issue: 'notANumber', isError: true };
    }

    if (parsed < 0) {
        return { value: null, issue: 'negative', isError: true };
    }

    if (parsed === 0) {
        // A deliberate zero and an untouched blank mean the same thing — leave this one out — so
        // they are excluded the same way. Typing 0 is how somebody says it on a row that arrived
        // with a suggestion already in it.
        return { value: null, issue: 'zero', isError: false };
    }

    const decimals = trimmed.includes('.') ? (trimmed.split('.')[1]?.length ?? 0) : 0;

    if (decimals > MAX_DECIMALS) {
        return { value: null, issue: 'tooPrecise', isError: true };
    }

    if (parsed >= MAX_QUANTITY) {
        return { value: null, issue: 'tooLarge', isError: true };
    }

    return { value: trimmed, issue: null, isError: false };
}

/** One row's state in the builder, keyed by its stock item. */
export interface SupplyOrderRowChoice {
    /** Exactly what is in the box, unparsed — the person's text, not a number. */
    readonly quantity: string;
    readonly supplierId: SupplierId | null;
    /**
     * `false` after the row's **Not ordering** toggle. Kept apart from a blank quantity so the
     * toggle can restore what was typed rather than having to remember it elsewhere.
     */
    readonly ordering: boolean;
}

/** Every row's state, keyed by `stockItemId`. */
export type SupplyOrderChoices = Readonly<Record<string, SupplyOrderRowChoice>>;

/**
 * How a row opens: the server's suggestion in the box, the server's supplier chosen, ordering on.
 *
 * A row with no suggestion opens **empty**, never zero. Zero is a decision; empty is the absence of
 * one, and prefilling a zero would make "not ordering" the default for exactly the rows that most
 * need a human number.
 */
export function initialChoice(row: OrderProposalItem): SupplyOrderRowChoice {
    return {
        quantity: row.suggestedQuantity ?? '',
        supplierId: row.suggestedSupplierId,
        ordering: true,
    };
}

/**
 * Opening state for a whole proposal, merged over what the person has already typed.
 *
 * `previous` wins for rows it already covers, which is what makes **Add another item** and Refresh
 * non-destructive: the proposal is re-read from the server, and the quantities somebody typed into
 * the rows that came back are still there. Rows that vanished from the answer drop out with it.
 */
export function initialChoices(
    rows: readonly OrderProposalItem[],
    previous: SupplyOrderChoices = {},
): SupplyOrderChoices {
    const next: Record<string, SupplyOrderRowChoice> = {};

    for (const row of rows) {
        const key = String(row.stockItemId);
        next[key] = previous[key] ?? initialChoice(row);
    }

    return next;
}

/** The minimum a group header needs to name its supplier. `SupplierOption` satisfies it. */
export interface SupplyOrderSupplier {
    readonly id: SupplierId;
    readonly code: string;
    readonly nameEn: string;
    readonly nameAr: string | null;
}

export interface SupplyOrderLine {
    readonly row: OrderProposalItem;
    /** The validated decimal string, never a number. */
    readonly quantity: string;
}

export interface SupplyOrderGroup {
    readonly supplier: SupplyOrderSupplier;
    readonly lines: readonly SupplyOrderLine[];
}

/** Why a row contributes no line. `noSupplier` rows are reported separately — see {@link SupplyOrderPlan}. */
export type ExclusionReason = 'notOrdering' | 'noQuantity' | 'invalidQuantity';

export interface SupplyOrderExclusion {
    readonly row: OrderProposalItem;
    readonly reason: ExclusionReason;
}

/**
 * What the builder is about to ask for.
 *
 * `unassigned` is kept out of `excluded` on purpose, and §4 is why: a row with a real quantity and
 * nobody to buy it from is a **job left undone**, and the confirmation has to say so in its own
 * words. A row somebody switched off is not. Lumping them together would let a person tick past
 * four shelves they still need because the summary said "eleven rows excluded".
 */
export interface SupplyOrderPlan {
    readonly groups: readonly SupplyOrderGroup[];
    /** Rows with an orderable quantity and no supplier chosen. */
    readonly unassigned: readonly OrderProposalItem[];
    readonly excluded: readonly SupplyOrderExclusion[];
    /** Total lines across every group — the number the confirmation quotes beside the order count. */
    readonly lineCount: number;
}

/**
 * Group the rows by the supplier chosen for each, preserving server order throughout.
 *
 * `directory` covers the Region B case: a row whose links are all archived, or which has none, may
 * still be assigned any active supplier in the kitchen's book — somebody the row's own
 * `supplierOptions` has never heard of. The row's options are consulted first because they carry
 * the preferred flag and the lead time; the directory is the fallback.
 *
 * A chosen supplier that resolves to nobody at all — a stale id from a supplier archived while the
 * screen was open — leaves the row `unassigned` rather than inventing a header for a supplier the
 * preview cannot name.
 */
export function buildGroups(
    rows: readonly OrderProposalItem[],
    choices: SupplyOrderChoices,
    directory: readonly SupplyOrderSupplier[] = [],
): SupplyOrderPlan {
    const byId = new Map<string, SupplyOrderSupplier>();
    for (const supplier of directory) {
        byId.set(String(supplier.id), supplier);
    }

    // Insertion-ordered, which is what preserves server order: a Map yields its keys in the order
    // they were first written, so the first row assigned to a supplier fixes that supplier's place.
    const groups = new Map<string, { supplier: SupplyOrderSupplier; lines: SupplyOrderLine[] }>();
    const unassigned: OrderProposalItem[] = [];
    const excluded: SupplyOrderExclusion[] = [];

    for (const row of rows) {
        const choice = choices[String(row.stockItemId)] ?? initialChoice(row);

        if (!choice.ordering) {
            excluded.push({ row, reason: 'notOrdering' });
            continue;
        }

        const quantity = readQuantity(choice.quantity);

        if (quantity.value === null) {
            excluded.push({
                row,
                reason: quantity.isError ? 'invalidQuantity' : 'noQuantity',
            });
            continue;
        }

        if (choice.supplierId === null) {
            unassigned.push(row);
            continue;
        }

        const key = String(choice.supplierId);
        const supplier =
            row.supplierOptions.find((option) => String(option.id) === key) ??
            byId.get(key) ??
            null;

        if (supplier === null) {
            unassigned.push(row);
            continue;
        }

        const existing = groups.get(key);

        if (existing === undefined) {
            groups.set(key, { supplier, lines: [{ row, quantity: quantity.value }] });
        } else {
            existing.lines.push({ row, quantity: quantity.value });
        }
    }

    const built = [...groups.values()].map((group) => ({
        supplier: group.supplier,
        lines: group.lines as readonly SupplyOrderLine[],
    }));

    return {
        groups: built,
        unassigned,
        excluded,
        lineCount: built.reduce((total, group) => total + group.lines.length, 0),
    };
}

/** One line of a draft purchase order, as slice 4's batch-create endpoint will want it. */
export interface SupplyOrderBatchLine {
    readonly stockItemId: StockItemId;
    readonly quantity: string;
}

/** One draft purchase order — one per supplier, in the order the preview showed them. */
export interface SupplyOrderBatchOrder {
    readonly supplierId: SupplierId;
    readonly branchId: BranchId;
    readonly lines: readonly SupplyOrderBatchLine[];
}

export interface SupplyOrderBatchPayload {
    readonly orders: readonly SupplyOrderBatchOrder[];
}

/**
 * The plan as a create request — the seam slice 4 lands on.
 *
 * It exists in this slice, unused by any button, and that is deliberate rather than speculative:
 * the grouping is only worth being a pure function if the thing a person confirms and the thing
 * that gets sent are provably the same object. Slice 4 adds the commit bar and the endpoint; this
 * function does not change.
 *
 * `branchId` comes off the rows rather than being passed in, because every proposal row carries the
 * branch it was read for — a payload whose branch disagreed with its lines would be unrepresentable
 * only by accident otherwise.
 *
 * Nothing here carries a price. There will be no price on a purchase order: what a delivery cost
 * belongs to the receipt that recorded it.
 */
export function toBatchPayload(plan: SupplyOrderPlan): SupplyOrderBatchPayload {
    return {
        orders: plan.groups.flatMap((group) => {
            const branchId = group.lines[0]?.row.branchId;

            if (branchId === undefined) return [];

            return [
                {
                    supplierId: group.supplier.id,
                    branchId,
                    lines: group.lines.map((line) => ({
                        stockItemId: line.row.stockItemId,
                        quantity: line.quantity,
                    })),
                },
            ];
        }),
    };
}

/**
 * Every active supplier a row may be assigned, row options first.
 *
 * The row's own options carry the preferred flag and the lead time and belong at the top; the rest
 * of the book follows for the Region B case. Deduped by id so a supplier that is both linked and in
 * the book appears once.
 */
export function supplierChoices(
    row: OrderProposalItem,
    directory: readonly SupplyOrderSupplier[],
): readonly SupplyOrderSupplier[] {
    const seen = new Set<string>();
    const choices: SupplyOrderSupplier[] = [];

    for (const supplier of [...row.supplierOptions, ...directory] as readonly (
        SupplierOption | SupplyOrderSupplier
    )[]) {
        const key = String(supplier.id);
        if (seen.has(key)) continue;
        seen.add(key);
        choices.push(supplier);
    }

    return choices;
}
