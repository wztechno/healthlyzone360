<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Carbon\CarbonImmutable;
use Healthy360\Orders\Contracts\PlanDayListing;

final class NullPlanDayListing implements PlanDayListing
{
    public function forDay(string $organisationId, CarbonImmutable $date, ?string $branchId = null): array
    {
        return [];
    }
}
