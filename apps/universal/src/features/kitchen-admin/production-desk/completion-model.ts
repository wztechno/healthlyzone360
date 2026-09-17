import type {
    AbandonProductionOrderRequest,
    CompleteProductionOrderRequest,
    ProductionOrderLine,
} from '@healthy360/api-client/contracts';

/**
 * The completion report as a form holds it, and the request it becomes (PROD1).
 *
 * Kept out of the screen because the interesting part is not the rendering: it is which blanks mean
 * *nothing* and which mean *as claimed*, and those two answers differ per field in a way nobody
 * should have to re-derive from a `?? 0` at a call site.
 *
 * ```
 *  produced   required          zero is an answer — the batch was lost
 *  rejected   blank ⇒ zero      inside produced, never beside it
 *  consumed   blank ⇒ as claimed   a cook who followed the recipe retypes nothing
 *  waste      blank ⇒ zero      input binned; it never became product
 * ```
 *
 * The asymmetry between `consumed` and `waste` is the whole reason this module exists. Sending
 * `consumed: 0` for every untouched shelf would tell the server a batch was cooked out of thin air;
 * sending `waste: {}` says nothing was binned, which is exactly what an untouched field means.
 */

export interface CompletionDraft {
    /** Free text while typing — a half-typed `1.` is not a number and must not be rounded to one. */
    readonly produced: string;
    readonly rejected: string;
    /** Stock item id → what actually went in. Absent keys are "as claimed". */
    readonly consumed: Readonly<Record<string, string>>;
    /** Stock item id → what went in the bin. Absent keys are zero. */
    readonly waste: Readonly<Record<string, string>>;
    readonly productionDate: string | null;
    readonly batchReference: string;
    readonly storageLocation: string;
    readonly expiryDate: string | null;
    readonly notes: string;
    /** Required to abandon, ignored when completing. */
    readonly reason: string;
}

export function emptyCompletionDraft(today: string | null = null): CompletionDraft {
    return {
        produced: '',
        rejected: '',
        consumed: {},
        waste: {},
        productionDate: today,
        batchReference: '',
        storageLocation: '',
        expiryDate: null,
        notes: '',
        reason: '',
    };
}

/**
 * The field a value belongs to, so one setter serves both per-line maps.
 */
export type LineField = 'consumed' | 'waste';

export function withLineQuantity(
    draft: CompletionDraft,
    field: LineField,
    stockItemId: string,
    value: string,
): CompletionDraft {
    const next = { ...draft[field] };

    // An emptied box goes back to meaning what a blank means, rather than to `''` — otherwise
    // clearing a mistake would send `consumed: NaN` for that shelf.
    if (value.trim() === '') {
        delete next[stockItemId];
    } else {
        next[stockItemId] = value;
    }

    return { ...draft, [field]: next };
}

/** A finite number, or `null` for anything that is not one — including a blank. */
export function readNumber(value: string): number | null {
    const trimmed = value.trim();
    if (trimmed === '') return null;

    const parsed = Number(trimmed);

    return Number.isFinite(parsed) ? parsed : null;
}

export interface CompletionErrors {
    readonly produced?: string;
    readonly rejected?: string;
    readonly reason?: string;
}

/**
 * What the form will not send, as i18n keys.
 *
 * Deliberately short. The server owns the real rules — a consumption above what is available, a
 * shelf in another currency — and a client that tried to pre-empt them would be a second, staler
 * copy of them. These three are the ones where the *form itself* is incoherent.
 */
export function completionErrors(
    draft: CompletionDraft,
    mode: 'complete' | 'abandon',
): CompletionErrors {
    const errors: { produced?: string; rejected?: string; reason?: string } = {};
    const produced = readNumber(draft.produced);
    const rejected = readNumber(draft.rejected);

    if (produced === null || produced < 0) {
        errors.produced = 'kitchen:ops.production.producedRequired';
    }

    if (rejected !== null && (rejected < 0 || (produced !== null && rejected > produced))) {
        errors.rejected = 'kitchen:ops.production.rejectedTooHigh';
    }

    if (mode === 'abandon' && draft.reason.trim() === '') {
        errors.reason = 'kitchen:ops.production.abandonReasonRequired';
    }

    return errors;
}

export function hasCompletionErrors(errors: CompletionErrors): boolean {
    return Object.keys(errors).length > 0;
}

/** Only the entries somebody actually typed, parsed. Unparseable text is dropped, not zeroed. */
function quantities(map: Readonly<Record<string, string>>): Record<string, number> {
    const parsed: Record<string, number> = {};

    for (const [stockItemId, value] of Object.entries(map)) {
        const quantity = readNumber(value);
        if (quantity !== null) parsed[stockItemId] = quantity;
    }

    return parsed;
}

/**
 * The request body, with every empty optional left off rather than sent as null.
 *
 * `consumed` and `waste` are omitted entirely when nobody typed anything, which is the difference
 * between "the cook followed the recipe" and "the cook used none of it".
 */
export function completionRequest(draft: CompletionDraft): CompleteProductionOrderRequest {
    const produced = readNumber(draft.produced) ?? 0;
    const rejected = readNumber(draft.rejected);
    const consumed = quantities(draft.consumed);
    const waste = quantities(draft.waste);

    return {
        producedQuantity: produced,
        ...(rejected === null ? {} : { rejectedQuantity: rejected }),
        ...(Object.keys(consumed).length === 0 ? {} : { consumed }),
        ...(Object.keys(waste).length === 0 ? {} : { waste }),
        ...(draft.productionDate === null ? {} : { productionDate: draft.productionDate }),
        ...(draft.batchReference.trim() === ''
            ? {}
            : { batchReference: draft.batchReference.trim() }),
        ...(draft.storageLocation.trim() === ''
            ? {}
            : { storageLocation: draft.storageLocation.trim() }),
        ...(draft.expiryDate === null ? {} : { expiryDate: draft.expiryDate }),
        ...(draft.notes.trim() === '' ? {} : { notes: draft.notes.trim() }),
    };
}

export function abandonRequest(draft: CompletionDraft): AbandonProductionOrderRequest {
    return { ...completionRequest(draft), reason: draft.reason.trim() };
}

/**
 * The shelves a completion form asks about, ingredients before packaging.
 *
 * `displayOrder` is the server's own ordering within each kind, and the two kinds are separated
 * because a cook reads down the ingredients and then checks the boxes — interleaving them by a
 * single sort key would put a lid between two spices.
 */
export function orderedLines(
    lines: readonly ProductionOrderLine[],
): readonly ProductionOrderLine[] {
    const byKind = (kind: ProductionOrderLine['lineKind']) =>
        lines
            .filter((line) => line.lineKind === kind)
            .slice()
            .sort((left, right) => left.displayOrder - right.displayOrder);

    return [...byKind('ingredient'), ...byKind('packaging')];
}
