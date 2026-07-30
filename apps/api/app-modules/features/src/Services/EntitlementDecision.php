<?php

declare(strict_types=1);

namespace Healthy360\Features\Services;

use Healthy360\Features\Enums\EntitlementDenialReason;

/**
 * Outcome of the standalone feature-entitlement check.
 */
final readonly class EntitlementDecision
{
    private function __construct(
        public bool $allowed,
        public ?EntitlementDenialReason $denialReason,
    ) {}

    public static function allow(): self
    {
        return new self(true, null);
    }

    public static function deny(EntitlementDenialReason $reason): self
    {
        return new self(false, $reason);
    }
}
