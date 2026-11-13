/**
 * The warning codes a preview can carry, and their copy.
 *
 * `CheckoutPreview.warnings` and `SubscriptionPreview.warnings` are `readonly string[]` — an open
 * vocabulary on the wire, deliberately, so a backend can add a warning without a client release
 * blocking it. That openness is only safe if the client handles an unrecognised code gracefully,
 * which is what {@link warningMessageKey} is for: known codes get written copy, and anything else
 * falls through to a generic sentence rather than rendering a raw `subscription.foo_bar` at a
 * person.
 *
 * The codes themselves are duplicated from the repository rather than imported, because the
 * repository that produces them is the mock world and application code may not reach into
 * `mock/**`. That duplication is a fact about the contract's design — warning codes should be part
 * of the published vocabulary — and is recorded as a gap rather than smoothed over.
 */

export const CHECKOUT_EMPTY_CART = 'checkout.empty_cart';
/** `address_missing` from `POST /checkouts/preview`, under the `checkout.` prefix the repository adds. */
export const CHECKOUT_ADDRESS_MISSING = 'checkout.address_missing';
/** The chosen slot is not one the address's delivery zone offers. */
export const CHECKOUT_WINDOW_NOT_OFFERED = 'checkout.window_not_offered';
/** `allergen_conflict` — a meal in the basket crosses the buyer's declared allergies. */
export const ALLERGEN_CONFLICT_WARNING = 'checkout.allergen_conflict';
/**
 * What `OrderTimingRules` and the item calendar refuse, warned about by the preview in the same
 * words, so the customer hears it before the button. The first three are the schedule's own.
 */
export const CHECKOUT_TIMING_WARNINGS = [
    'checkout.closed',
    'checkout.date_in_the_past',
    'checkout.cut_off_passed',
    'checkout.kitchen_closed',
    'checkout.window_ended',
    'checkout.lead_time_not_met',
    'checkout.below_zone_minimum',
    'checkout.item_unavailable_on_date',
    'checkout.kitchen_paused',
    'checkout.kitchen_not_open',
    'checkout.window_full',
] as const;
/** `item_not_assessed` — nobody has assessed a dish in the basket for allergens, so it is off sale. */
export const CHECKOUT_ITEM_NOT_ASSESSED = 'checkout.item_not_assessed';
/** `quality_hold` — all that is left of something in the basket is on quality hold. */
export const CHECKOUT_QUALITY_HOLD = 'checkout.quality_hold';
/** `stock_short` — the basket needs more than the free stock; held stock never counts. Sold anyway. */
export const CHECKOUT_STOCK_SHORT = 'checkout.stock_short';
/** `phone_required` — a delivery with no number the driver can ring. Placement refuses it. */
export const CHECKOUT_PHONE_REQUIRED = 'checkout.phone_required';
/** A picked meal crosses the person's allergies; generation would swap it for a safe one. */
export const SUBSCRIPTION_ALLERGEN_CONFLICT = 'subscription.allergen_conflict';
export const SUBSCRIPTION_NO_DELIVERY_DAYS = 'subscription.no_delivery_days';
export const SUBSCRIPTION_DAY_UNAVAILABLE = 'subscription.delivery_day_unavailable';
export const SUBSCRIPTION_UNKNOWN_SLOT = 'subscription.unknown_slot';

const KNOWN: ReadonlySet<string> = new Set([
    CHECKOUT_EMPTY_CART,
    CHECKOUT_ADDRESS_MISSING,
    CHECKOUT_WINDOW_NOT_OFFERED,
    ...CHECKOUT_TIMING_WARNINGS,
    CHECKOUT_ITEM_NOT_ASSESSED,
    CHECKOUT_QUALITY_HOLD,
    CHECKOUT_STOCK_SHORT,
    CHECKOUT_PHONE_REQUIRED,
    ALLERGEN_CONFLICT_WARNING,
    SUBSCRIPTION_ALLERGEN_CONFLICT,
    SUBSCRIPTION_NO_DELIVERY_DAYS,
    SUBSCRIPTION_DAY_UNAVAILABLE,
    SUBSCRIPTION_UNKNOWN_SLOT,
]);

/** Warnings that are a safety matter rather than an inconvenience, and get an alert tone. */
const CRITICAL: ReadonlySet<string> = new Set([
    ALLERGEN_CONFLICT_WARNING,
    SUBSCRIPTION_ALLERGEN_CONFLICT,
]);

export function isKnownWarning(code: string): boolean {
    return KNOWN.has(code);
}

export function isCriticalWarning(code: string): boolean {
    return CRITICAL.has(code);
}

/**
 * The translation key for a warning. Unknown codes resolve to one generic key; the code itself is
 * passed as an interpolation so a reviewer can still see which one arrived.
 */
export function warningMessageKey(code: string): string {
    return KNOWN.has(code)
        ? `commerce:warnings.${code.replace(/\./g, '_')}`
        : 'commerce:warnings.unknown';
}

/** Warnings worth showing. `checkout.empty_cart` is dropped: the empty state already says it. */
export function displayableWarnings(warnings: readonly string[]): readonly string[] {
    return warnings.filter((code) => code !== CHECKOUT_EMPTY_CART);
}
