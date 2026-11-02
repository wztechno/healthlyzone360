<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Services;

use Healthy360\Kitchens\Models\KitchenServiceSettings;

/**
 * A kitchen's service timings, created with defaults the first time they are
 * asked for, so no kitchen needs a back-fill and no caller needs a null check.
 *
 * `firstOrCreate` settles concurrent first reads on the `organisation_id` unique
 * index: the loser's insert is refused and it reads the winner's row.
 *
 * `withoutTenancy()` because the organisation is named here, and a scheduled job
 * declares it to the database rather than to `TenantContext`. Only the Eloquent
 * scope is dropped; the row-level security policy still decides.
 */
final class KitchenServiceSettingsLookup
{
    public function for(string $organisationId): KitchenServiceSettings
    {
        return KitchenServiceSettings::withoutTenancy()->firstOrCreate(['organisation_id' => $organisationId]);
    }
}
