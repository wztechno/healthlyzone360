<?php

declare(strict_types=1);

namespace Healthy360\B2b\Models;

use Carbon\CarbonImmutable;
use Healthy360\ReferenceData\Models\DeliveryArea;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Somewhere an applicant company wants food delivered, anchored to the
 * platform gazetteer where the gazetteer covers it.
 *
 * @property string $id
 * @property string $b2b_application_id
 * @property string $label
 * @property string|null $delivery_area_id
 * @property string $address_line1
 * @property string|null $address_line2
 * @property string|null $city
 * @property string|null $country_code
 * @property string|null $contact_name
 * @property string|null $contact_phone
 * @property string|null $delivery_notes
 * @property bool $is_primary
 * @property bool $is_billing_address
 * @property int|null $expected_headcount
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Confidential, 'address_line1', 'address_line2', 'contact_name', 'contact_phone')]
class B2bApplicationLocation extends BaseModel
{
    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'is_primary' => 'boolean',
            'is_billing_address' => 'boolean',
            'expected_headcount' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<B2bApplication, $this>
     */
    public function application(): BelongsTo
    {
        return $this->belongsTo(B2bApplication::class, 'b2b_application_id');
    }

    /**
     * @return BelongsTo<DeliveryArea, $this>
     */
    public function deliveryArea(): BelongsTo
    {
        return $this->belongsTo(DeliveryArea::class, 'delivery_area_id');
    }
}
