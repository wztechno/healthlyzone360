<?php

declare(strict_types=1);

namespace Healthy360\ReferenceData\Models;

use Carbon\CarbonImmutable;
use Healthy360\ReferenceData\Database\Factories\DeliveryAreaFactory;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A named place the platform recognises as a delivery destination.
 *
 * Platform reference data, not tenant data: two kitchens serving Achrafieh
 * serve the *same* Achrafieh, and that shared identity is what lets an address
 * captured in J1 be matched against any kitchen's zones. A kitchen's own
 * grouping of these — with its fee, its minimum order and its promise about
 * how long it takes — is a `DeliveryZone`.
 *
 * The name is the source's. `Beirut Airpot` is not a typo this model fixes.
 *
 * @property string $id
 * @property string $country_code
 * @property string $code
 * @property string $name_en
 * @property string $name_ar
 * @property string|null $region
 * @property int $display_order
 * @property bool $is_active
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class DeliveryArea extends BaseModel
{
    /** @use HasFactory<DeliveryAreaFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'display_order' => 'integer',
            'is_active' => 'boolean',
        ];
    }

    /**
     * @return BelongsTo<Country, $this>
     */
    public function country(): BelongsTo
    {
        return $this->belongsTo(Country::class, 'country_code', 'code');
    }
}
