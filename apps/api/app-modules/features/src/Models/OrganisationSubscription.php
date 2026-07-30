<?php

declare(strict_types=1);

namespace Healthy360\Features\Models;

use Carbon\CarbonImmutable;
use Healthy360\Features\Database\Factories\OrganisationSubscriptionFactory;
use Healthy360\Features\Enums\SubscriptionStatus;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;

/**
 * An organisation's subscription; billing detail is deferred.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $package_code
 * @property SubscriptionStatus $status
 * @property CarbonImmutable $starts_at
 * @property CarbonImmutable|null $ends_at
 * @property string|null $created_by
 * @property int $lock_version
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class OrganisationSubscription extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<OrganisationSubscriptionFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => SubscriptionStatus::class,
            'starts_at' => 'datetime',
            'ends_at' => 'datetime',
        ];
    }
}
