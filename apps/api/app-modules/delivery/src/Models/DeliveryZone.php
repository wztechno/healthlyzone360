<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Delivery\Database\Factories\DeliveryZoneFactory;
use Healthy360\Delivery\Enums\DeliveryZoneStatus;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One kitchen's commercial statement about a set of places: what it charges to
 * reach them, what it will not go below, and roughly how long it takes.
 *
 * Classified `Internal` rather than `Confidential`: a delivery fee is printed
 * on the kitchen's own checkout page. What is confidential in this programme
 * is what things cost the kitchen, not what it charges to bring them.
 *
 * `branch_id` NULL is the organisation-wide map; a branch-scoped zone
 * overrides it for that branch. Resolution lives in `ZoneResolver` and nowhere
 * else.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string|null $branch_id
 * @property string $code
 * @property string $name_en
 * @property string $name_ar
 * @property string $currency_code
 * @property int|null $delivery_fee_minor
 * @property int|null $minimum_order_minor
 * @property int|null $estimated_minutes
 * @property DeliveryZoneStatus $status
 * @property string|null $source_system
 * @property string|null $source_ref
 * @property CarbonImmutable|null $seeded_at
 * @property string|null $created_by
 * @property string|null $updated_by
 * @property int $lock_version
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Internal, 'code', 'name_en', 'name_ar')]
class DeliveryZone extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<DeliveryZoneFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => DeliveryZoneStatus::class,
            'delivery_fee_minor' => 'integer',
            'minimum_order_minor' => 'integer',
            'estimated_minutes' => 'integer',
            'seeded_at' => 'immutable_datetime',
            'lock_version' => 'integer',
        ];
    }

    public function isEditable(): bool
    {
        return $this->status->isEditable();
    }

    /**
     * Whether this zone is the organisation's default map rather than one
     * branch's override.
     */
    public function isOrganisationWide(): bool
    {
        return $this->branch_id === null;
    }

    /**
     * @return HasMany<DeliveryZoneArea, $this>
     */
    public function areas(): HasMany
    {
        return $this->hasMany(DeliveryZoneArea::class);
    }

    /**
     * @return BelongsTo<OrganisationBranch, $this>
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(OrganisationBranch::class, 'branch_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function updater(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }
}
