import type { LocalisedText } from '@healthy360/api-client/contracts';

/**
 * The desk basket — what the agent has tapped, before it is a quote and long before it is an order.
 *
 * ## Why a basket model exists at all when the server merges too
 *
 * `order_lines` holds **one row per article** (`order_lines_one_row_per_article`, unique on
 * `(order_id, catalogue_item_id, catalogue_item_variant_id)` with `NULLS NOT DISTINCT`), and both
 * desk endpoints merge duplicate lines server-side before they build anything. So the client could
 * send three separate taps of the same coffee and get one line back.
 *
 * It aggregates here anyway, and for a reason the server cannot help with: **the agent has to see
 * the number they are about to charge for.** A basket that showed "Coffee ×1" three times while the
 * quote answered "Coffee ×3" would be two different accounts of the same sale on one screen, and the
 * one the customer is read out loud is whichever the agent happened to look at. Aggregating on tap
 * makes the line the agent sees the line the server will build — and the quantity stepper on the row
 * then has something to step.
 *
 * ## The key is the pair, not the article
 *
 * An article ordered plain and the same article ordered in a pack are **two different things to
 * sell**, and the database's `NULLS NOT DISTINCT` says so: `(item, NULL)` and `(item, variant)` are
 * two rows. {@link basketKey} therefore keys on the pair and spells the absent variant explicitly
 * rather than letting `undefined` stringify — `"item|"` and `"item|undefined"` colliding through
 * template interpolation is the sort of bug that merges two prices into one.
 *
 * ## Quantities are decimal strings, and the arithmetic is integer arithmetic
 *
 * Every quantity on this platform is a decimal string on the wire and in every model that holds one
 * (`ops-line-editor.tsx`, `KitchenOrderLine.quantity`) — because a counter sells 0.35 kg as readily
 * as three coffees, and a float round trip is how 0.35 becomes 0.34999999999999998. There is no
 * bcmath in a browser, so {@link addQuantity} scales both operands to a fixed number of decimal
 * places, adds them as integers, and renders the result back. The scale is
 * {@link QUANTITY_SCALE} — the platform's own bcmath `SCALE`, so a quantity this module produces is
 * a quantity the server can consume without rounding it a second time.
 *
 * In practice a desk basket holds integers. The decimal path exists because the wire accepts one and
 * a weighed article will eventually use it, not because this screen offers a gram field today.
 */

/** Decimal places carried through client-side quantity arithmetic — the platform's bcmath `SCALE`. */
export const QUANTITY_SCALE = 6;

/** What a quantity stepper adds on one tap, and the quantity a freshly added line starts at. */
export const DEFAULT_LINE_QUANTITY = '1';

/**
 * The most any one line may hold.
 *
 * A ceiling rather than an unbounded field, because the fastest way to place a five-figure order by
 * accident is a stepper button that repeats under a resting finger. High enough that no real counter
 * sale meets it; low enough that meeting it is obviously a mistake.
 */
export const MAX_LINE_QUANTITY = 999;

/**
 * One article in the basket, keyed by {@link basketKey}.
 *
 * `name` is a **snapshot taken from the picker**, not the truth about the article: the quote answers
 * its own `nameEn`/`nameAr` and a screen prefers those once they land. It is held here so a line that
 * has just been tapped has something to render in the frame before the debounced quote returns —
 * a row that said nothing until the network answered would make every tap feel broken.
 */
export interface BasketLine {
    readonly catalogueItemId: string;
    /** `null`, never `undefined` — the absent variant is a value here, not a missing key. */
    readonly catalogueItemVariantId: string | null;
    /** A decimal string. See the module note on why this is never a number. */
    readonly quantity: string;
    readonly name: LocalisedText;
    /** The pack's own label, when this line is a variant. Display only. */
    readonly variantLabel: string | null;
}

/** What the basket sends per line. Exactly the wire's `OrderDeskBasketLine`, in domain casing. */
export interface BasketWireLine {
    readonly catalogueItemId: string;
    readonly catalogueItemVariantId: string | null;
    readonly quantity: string;
}

/**
 * The identity of a basket row: the article **and** the pack.
 *
 * The absent variant is spelled `-` rather than left to interpolate, so no article identifier
 * ending in a literal `undefined` can be made to collide with a real variant.
 */
export function basketKey(catalogueItemId: string, catalogueItemVariantId: string | null): string {
    return `${catalogueItemId}|${catalogueItemVariantId ?? '-'}`;
}

/** The key of a line already in the basket. */
export function lineKey(line: BasketLine): string {
    return basketKey(line.catalogueItemId, line.catalogueItemVariantId);
}

/* ------------------------------------------------------------------------------------------------
 * Decimal-string arithmetic
 * ---------------------------------------------------------------------------------------------- */

/**
 * A quantity as a scaled integer, or `null` when the text is not a quantity at all.
 *
 * Rejects anything that is not an unsigned decimal literal — no exponents, no signs, no thousands
 * separators — because the only strings this module ever sees come from its own output, from a
 * numeric stepper, or from a typed field, and a permissive parse is how `1e3` becomes a thousand
 * coffees. Digits past {@link QUANTITY_SCALE} are truncated rather than rounded: the server would
 * refuse them anyway, and rounding *up* would charge for a gram nobody asked for.
 */
function toScaled(quantity: string): number | null {
    const trimmed = quantity.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;

    const [whole = '0', fraction = ''] = trimmed.split('.');
    const padded = fraction.padEnd(QUANTITY_SCALE, '0').slice(0, QUANTITY_SCALE);
    const scaled = Number(`${whole}${padded}`);
    return Number.isSafeInteger(scaled) ? scaled : null;
}

/** A scaled integer back to the shortest decimal string that means it. */
function fromScaled(scaled: number): string {
    const whole = Math.trunc(scaled / 10 ** QUANTITY_SCALE);
    const fraction = String(scaled % 10 ** QUANTITY_SCALE)
        .padStart(QUANTITY_SCALE, '0')
        .replace(/0+$/, '');
    return fraction === '' ? String(whole) : `${String(whole)}.${fraction}`;
}

/**
 * `left + right`, exactly, as decimal strings.
 *
 * An unreadable operand contributes nothing rather than poisoning the sum to `NaN`: a basket whose
 * total silently became "NaN" because one row held a stray character would be unusable, and the
 * quantity that *can* be read is still the better answer.
 */
export function addQuantity(left: string, right: string): string {
    const a = toScaled(left) ?? 0;
    const b = toScaled(right) ?? 0;
    return fromScaled(Math.min(a + b, MAX_LINE_QUANTITY * 10 ** QUANTITY_SCALE));
}

/** True when the text is a quantity the wire would accept: readable, and greater than zero. */
export function isSellableQuantity(quantity: string): boolean {
    const scaled = toScaled(quantity);
    return scaled !== null && scaled > 0 && scaled <= MAX_LINE_QUANTITY * 10 ** QUANTITY_SCALE;
}

/** A quantity as a number, for a stepper control that can only hold one. `null` when unreadable. */
export function quantityAsNumber(quantity: string): number | null {
    const scaled = toScaled(quantity);
    return scaled === null ? null : scaled / 10 ** QUANTITY_SCALE;
}

/**
 * A number from a stepper back to a quantity string.
 *
 * Clamped to the sellable band rather than trusted: `NumberStepper` answers `null` for an emptied
 * field and will happily hand back whatever somebody typed into it.
 */
export function quantityFromNumber(value: number | null): string {
    if (value === null || !Number.isFinite(value) || value <= 0) return '0';
    return fromScaled(
        Math.min(
            Math.round(value * 10 ** QUANTITY_SCALE),
            MAX_LINE_QUANTITY * 10 ** QUANTITY_SCALE,
        ),
    );
}

/* ------------------------------------------------------------------------------------------------
 * The basket itself
 * ---------------------------------------------------------------------------------------------- */

/** What a picker hands over when somebody taps an article. */
export interface BasketAddition {
    readonly catalogueItemId: string;
    readonly catalogueItemVariantId: string | null;
    readonly name: LocalisedText;
    readonly variantLabel: string | null;
}

/**
 * Tap an article into the basket.
 *
 * A second tap of the same `(article, pack)` **adds to the existing line's quantity in place** —
 * first-seen position preserved, exactly as the server's own merge does it, so the row does not jump
 * to the bottom of the basket under a finger that is tapping the same button. A new pair appends.
 *
 * The display snapshot of an existing line is left alone rather than overwritten: it is the same
 * article, and rewriting it on every tap would make the row flicker for no gain.
 */
export function addItem(
    lines: readonly BasketLine[],
    addition: BasketAddition,
    quantity: string = DEFAULT_LINE_QUANTITY,
): readonly BasketLine[] {
    const key = basketKey(addition.catalogueItemId, addition.catalogueItemVariantId);
    const existing = lines.findIndex((line) => lineKey(line) === key);

    if (existing === -1) {
        return [
            ...lines,
            {
                catalogueItemId: addition.catalogueItemId,
                catalogueItemVariantId: addition.catalogueItemVariantId,
                quantity,
                name: addition.name,
                variantLabel: addition.variantLabel,
            },
        ];
    }

    return lines.map((line, index) =>
        index === existing ? { ...line, quantity: addQuantity(line.quantity, quantity) } : line,
    );
}

/**
 * Set one line's quantity outright.
 *
 * A quantity that is no longer sellable — zero, or emptied to nothing — **removes the line**, because
 * that is what somebody stepping a quantity down to zero means and leaving a 0 × row in the basket
 * would send the wire a line it refuses with a `422` the agent cannot act on.
 */
export function setQuantity(
    lines: readonly BasketLine[],
    key: string,
    quantity: string,
): readonly BasketLine[] {
    if (!isSellableQuantity(quantity)) return removeLine(lines, key);
    return lines.map((line) => (lineKey(line) === key ? { ...line, quantity } : line));
}

export function removeLine(lines: readonly BasketLine[], key: string): readonly BasketLine[] {
    return lines.filter((line) => lineKey(line) !== key);
}

/** Distinct articles in the basket — the number a "3 items" summary means. */
export function basketLineCount(lines: readonly BasketLine[]): number {
    return lines.length;
}

/** True when there is something here a quote could price. */
export function isQuotableBasket(lines: readonly BasketLine[]): boolean {
    return lines.length > 0 && lines.every((line) => isSellableQuantity(line.quantity));
}

/**
 * The basket as the quote and the placement take it.
 *
 * Unsellable lines are dropped rather than sent: they cannot have got here through the basket's own
 * controls (which remove a line at zero), so one that exists is a bug, and sending it would turn a
 * client bug into a `422` on a screen with a customer standing in front of it.
 */
export function toWire(lines: readonly BasketLine[]): readonly BasketWireLine[] {
    return lines
        .filter((line) => isSellableQuantity(line.quantity))
        .map((line) => ({
            catalogueItemId: line.catalogueItemId,
            catalogueItemVariantId: line.catalogueItemVariantId,
            quantity: line.quantity,
        }));
}
