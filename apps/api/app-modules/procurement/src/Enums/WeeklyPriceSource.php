<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Enums;

/**
 * What a published weekly price row actually is.
 *
 * Three answers, and keeping them distinct is what stops a screen showing a
 * confident figure that nobody bought anything to justify.
 *
 * `Computed` — the week's priced purchases were averaged. The only source whose
 * `total_quantity` and `total_cost_amount` mean anything.
 *
 * `CarriedForward` — the week produced no usable average, so the previous
 * standing price stands on. The requirement's own wording: "retain its most
 * recent available weekly price and display its effective date". The effective
 * date is why the row exists at all rather than the reader simply falling back
 * to an older one — a carried row states, on the week it belongs to, that this is
 * last week's number and how old it is.
 *
 * `Unpriced` — there is nothing to carry either. The ingredient has never been
 * bought at a recorded price, or the only price that could be carried cannot be
 * expressed in the unit the ingredient stocks in today. It carries no amount at
 * all, which is what "flag ingredients with no purchase history for initial price
 * entry" reads from. **Never zero:** a free ingredient and an unknown one are
 * different facts, and a zero here would cost a whole recipe wrongly and silently.
 */
enum WeeklyPriceSource: string
{
    case Computed = 'computed';
    case CarriedForward = 'carried_forward';
    case Unpriced = 'unpriced';
}
