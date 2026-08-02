<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Pricing\Database\Factories\ChannelPriceListFactory;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One channel consults one tariff, at one priority. Lower is consulted first.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $sales_channel_id
 * @property string $price_list_id
 * @property int $priority
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Internal, 'priority')]
class ChannelPriceList extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<ChannelPriceListFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['priority' => 'integer'];
    }

    /**
     * @return BelongsTo<SalesChannel, $this>
     */
    public function salesChannel(): BelongsTo
    {
        return $this->belongsTo(SalesChannel::class);
    }

    /**
     * @return BelongsTo<PriceList, $this>
     */
    public function priceList(): BelongsTo
    {
        return $this->belongsTo(PriceList::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
