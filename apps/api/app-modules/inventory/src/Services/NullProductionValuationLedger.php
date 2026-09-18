<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Services;

use Healthy360\Inventory\Contracts\ProductionValuationLedger;

/**
 * No batches, so nothing unvalued (PROD1).
 *
 * The default binding, replaced by Production when it is installed. An empty map
 * rather than a thrown "not implemented": a monthly cost report on an
 * installation with no production module is a perfectly good report, and it must
 * not flag a month for a batch that cannot have happened.
 */
final readonly class NullProductionValuationLedger implements ProductionValuationLedger
{
    /**
     * @return array<string, int>
     */
    public function unvaluedBatchCountByMonth(string $organisationId, ?string $from = null, ?string $to = null): array
    {
        return [];
    }
}
