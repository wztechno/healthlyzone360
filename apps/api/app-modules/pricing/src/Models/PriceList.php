<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Pricing\Database\Factories\PriceListFactory;
use Healthy360\Pricing\Enums\CustomerScope;
use Healthy360\Pricing\Enums\PriceListStatus;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A named set of prices, denominated in exactly one currency.
 *
 * Classified `Internal` rather than `Confidential`: the header is a name, a
 * currency and a status. The numbers — the part a competitor would pay for —
 * are in `PriceListItem`, which is classified `Confidential` and carries a
 * PostgreSQL policy of its own.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string|null $branch_id
 * @property string $code
 * @property string $name_en
 * @property string $name_ar
 * @property string $currency_code
 * @property CustomerScope $customer_scope
 * @property PriceListStatus $status
 * @property CarbonImmutable|null $valid_from
 * @property CarbonImmutable|null $valid_to
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
class PriceList extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<PriceListFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'customer_scope' => CustomerScope::class,
            'status' => PriceListStatus::class,
            'valid_from' => 'immutable_date',
            'valid_to' => 'immutable_date',
            'seeded_at' => 'immutable_datetime',
            'lock_version' => 'integer',
        ];
    }

    public function isEditable(): bool
    {
        return $this->status->isEditable();
    }

    /**
     * Whether this list's own window covers the given day. Both ends are
     * inclusive: the window is written by a human, and "valid to 30 June"
     * means through the 30th.
     */
    public function isInEffectOn(CarbonImmutable $date): bool
    {
        if ($this->valid_from !== null && $date->lessThan($this->valid_from)) {
            return false;
        }

        return $this->valid_to === null || ! $date->greaterThan($this->valid_to);
    }

    /**
     * @return HasMany<PriceListItem, $this>
     */
    public function entries(): HasMany
    {
        return $this->hasMany(PriceListItem::class);
    }

    /**
     * @return HasMany<ChannelPriceList, $this>
     */
    public function channelAssignments(): HasMany
    {
        return $this->hasMany(ChannelPriceList::class);
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
