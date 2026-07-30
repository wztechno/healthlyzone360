<?php

declare(strict_types=1);

namespace Healthy360\Support\Identifiers;

use Illuminate\Support\Str;

/**
 * Central Healthy360 identifier service (plan §8).
 *
 * All application-generated primary keys are ordered UUIDv7 values produced
 * here, so the generation strategy has exactly one owner. ISO-code reference
 * tables keep their natural primary keys and do not use this service.
 */
class IdentifierService
{
    /**
     * Generate a new ordered UUIDv7 identifier.
     */
    public function generate(): string
    {
        return (string) Str::uuid7();
    }
}
