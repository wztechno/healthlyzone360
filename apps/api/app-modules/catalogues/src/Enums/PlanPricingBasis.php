<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Enums;

/**
 * What the number on a price row *means* for a subscription plan: a day of it,
 * a week of it, or the whole run.
 *
 * It lives on the plan rather than on the price because it is a fact about the
 * plan's commercial shape, not about any one tariff. Two lists quoting the same
 * plan on two different bases would be two answers to "what does a week cost",
 * and the resolver has no way to prefer one.
 */
enum PlanPricingBasis: string
{
    case PerDay = 'per_day';
    case PerWeek = 'per_week';
    case Total = 'total';
}
