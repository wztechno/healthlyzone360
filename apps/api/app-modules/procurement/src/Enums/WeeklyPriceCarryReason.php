<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Enums;

/**
 * Why a week could not be averaged, and last week's price had to stand on.
 *
 * Separate from {@see WeeklyPriceSource} because the source says *what the row
 * is* and this says *what somebody may need to do about it*. One of these is a
 * shrug and three are work:
 *
 * `NoPurchases` — nothing was bought. Ordinary, and the common case for anything
 * bought monthly.
 *
 * `MixedCurrency` — the week's purchases of this ingredient were invoiced in two
 * currencies. There is no exchange rate in this system (§4.4) and this is not the
 * place to invent one, so the week is not averaged. Somebody has to decide which
 * currency this ingredient is bought in.
 *
 * `AllLinesUnpriced` — deliveries arrived and none of them has an invoice price
 * yet. The **Unpriced receipts** queue already exists for exactly this, and
 * completing those prices makes the next publication computable.
 *
 * `NotConvertible` — the ingredient's default unit has moved since the price
 * being carried was published, and the old price cannot be restated in the new
 * unit (a price per piece against a shelf now counted in kilograms). Carrying it
 * anyway would be off by whatever a piece weighs. This one degrades to
 * {@see WeeklyPriceSource::Unpriced} rather than carrying, because the honest
 * answer is that there is no usable price — the three outcomes
 * `IngredientCostService::rebaseHeldBalance()` already distinguishes.
 */
enum WeeklyPriceCarryReason: string
{
    case NoPurchases = 'no_purchases';
    case MixedCurrency = 'mixed_currency';
    case AllLinesUnpriced = 'all_lines_unpriced';
    case NotConvertible = 'not_convertible';
}
