<?php

declare(strict_types=1);

namespace Healthy360\Identity\Services;

use Healthy360\Identity\Contracts\ProgrammeMembershipLookup;

/**
 * The default when no B2B module is bound — every organisation belongs to no
 * corporate programme.
 */
final readonly class NullProgrammeMembershipLookup implements ProgrammeMembershipLookup
{
    public function activeProgrammesFor(string $organisationId): array
    {
        return [];
    }
}
