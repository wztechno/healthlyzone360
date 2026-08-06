<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use Healthy360\B2b\Models\CorporateProgramme;
use Healthy360\Identity\Contracts\ProgrammeMembershipLookup as ProgrammeMembershipLookupContract;

/**
 * Answers `/me`'s "what programmes does this organisation belong to" (B2)
 * with the buyer's own active programmes, `withoutTenancy()` because `/me`
 * itself has not necessarily entered this organisation's context yet — the
 * hydrator calls this while establishing it.
 */
final readonly class ProgrammeMembershipLookup implements ProgrammeMembershipLookupContract
{
    public function activeProgrammesFor(string $organisationId): array
    {
        return CorporateProgramme::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('status', 'active')
            ->orderByDesc('created_at')
            ->get(['id', 'code', 'name_en', 'name_ar', 'kitchen_organisation_id'])
            ->map(static fn (CorporateProgramme $programme): array => [
                'id' => (string) $programme->getKey(),
                'code' => $programme->code,
                'name_en' => $programme->name_en,
                'name_ar' => $programme->name_ar,
                'kitchen_organisation_id' => (string) $programme->kitchen_organisation_id,
            ])
            ->all();
    }
}
