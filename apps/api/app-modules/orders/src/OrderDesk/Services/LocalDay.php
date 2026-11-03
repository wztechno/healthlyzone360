<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Services;

use DateTimeZone;
use Healthy360\Orders\Contracts\OrderSchedulingLookup;
use Healthy360\Organisations\Services\OrganisationTimezone;

/**
 * Which clock a desk "day" is read on: the branch's when one is named, else the
 * kitchen's, the clock `DailyCloses` uses (owner, 3 Nov).
 *
 * The answer is always an identifier from `DateTimeZone::listIdentifiers()`, so a
 * caller may put it in an `at time zone '…'` literal. Both sources validate
 * already; this checks again because the SQL is only safe if it holds.
 */
final readonly class LocalDay
{
    public function __construct(
        private OrganisationTimezone $organisations,
        private OrderSchedulingLookup $branches,
    ) {}

    public function zone(string $organisationId, ?string $branchId = null): string
    {
        $zone = $branchId === null
            ? $this->organisations->forOrganisationId($organisationId)
            : $this->branches->timezoneOf($branchId);

        return in_array($zone, DateTimeZone::listIdentifiers(), true) ? $zone : 'UTC';
    }
}
