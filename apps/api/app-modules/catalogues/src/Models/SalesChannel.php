<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Database\Factories\SalesChannelFactory;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Enums\SalesChannelStatus;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A route to market an organisation sells through.
 *
 * Always owned by exactly one organisation — there is no platform channel
 * library, because a channel is a commercial arrangement and a shared one
 * would mean two tenants writing availability against the same parent.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $code
 * @property SalesChannelKind $channel_kind
 * @property string $name_en
 * @property string $name_ar
 * @property string|null $order_source
 * @property SalesChannelStatus $status
 * @property string|null $created_by
 * @property string|null $updated_by
 * @property int $lock_version
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Internal, 'code', 'name_en', 'name_ar', 'order_source')]
class SalesChannel extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<SalesChannelFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'channel_kind' => SalesChannelKind::class,
            'status' => SalesChannelStatus::class,
            'lock_version' => 'integer',
        ];
    }

    /**
     * @return HasMany<ChannelCatalogueItem, $this>
     */
    public function assignments(): HasMany
    {
        return $this->hasMany(ChannelCatalogueItem::class);
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
