<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Services;

use Healthy360\Customers\Closure\Contracts\B2bSignatoryPresence;

/**
 * The answer when no B2B module is bound: **we did not look**.
 *
 * The twin of `NullSubscriptionPresence`, and the same distinction applies:
 * zero here is the absence of a place to count from, not the absence of pending
 * signatures. The blocker reads `isAvailable()` and reports `not_applicable`
 * with the reason, so a corporate signatory is never told their pending
 * agreements are clear by a check that never ran.
 *
 * Replaced this wave by the B2B side's adapter, bound onto this interface by
 * integrator-2.
 */
final class NullB2bSignatoryPresence implements B2bSignatoryPresence
{
    public function isAvailable(): bool
    {
        return false;
    }

    public function pendingSignatureCount(string $userId): int
    {
        return 0;
    }
}
