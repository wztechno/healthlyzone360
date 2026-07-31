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
export const ALLERGEN_CONFLICT_WARNING = 'planner.allergen_conflict';
export const SUBSCRIPTION_NO_DELIVERY_DAYS = 'subscription.no_delivery_days';
export const SUBSCRIPTION_DAY_UNAVAILABLE = 'subscription.delivery_day_unavailable';
export const SUBSCRIPTION_UNKNOWN_SLOT = 'subscription.unknown_slot';

const KNOWN: ReadonlySet<string> = new Set([
    CHECKOUT_EMPTY_CART,
    ALLERGEN_CONFLICT_WARNING,
    SUBSCRIPTION_NO_DELIVERY_DAYS,
    SUBSCRIPTION_DAY_UNAVAILABLE,
    SUBSCRIPTION_UNKNOWN_SLOT,
]);

/** Warnings that are a safety matter rather than an inconvenience, and get an alert tone. */
const CRITICAL: ReadonlySet<string> = new Set([ALLERGEN_CONFLICT_WARNING]);

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
