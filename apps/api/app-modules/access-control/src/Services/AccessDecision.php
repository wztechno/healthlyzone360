<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Services;

use Healthy360\AccessControl\Enums\AccessDenialReason;

/**
 * Outcome of the six-step RBAC decision: allowed, or denied with exactly one
 * distinct, testable reason.
 */
final readonly class AccessDecision
{
    private function __construct(
        public bool $allowed,
        public ?AccessDenialReason $denialReason,
    ) {}

    public static function allow(): self
    {
        return new self(true, null);
    }

    public static function deny(AccessDenialReason $reason): self
    {
        return new self(false, $reason);
    }
}
