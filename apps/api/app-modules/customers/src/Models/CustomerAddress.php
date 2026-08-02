<?php

declare(strict_types=1);

namespace Healthy360\Customers\Models;

use Carbon\CarbonImmutable;
use Healthy360\Customers\Database\Factories\CustomerAddressFactory;
use Healthy360\Customers\Enums\CustomerAddressType;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\ReferenceData\Models\DeliveryArea;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One place a customer's food goes.
 *
 * Every free-text part is `Confidential` — an address identifies a person more
 * reliably than their name does. The area is not: it is a platform reference
 * entry naming a district, and it appears on the kitchen's own coverage map.
 *
 * @property string $id
 * @property string $customer_account_id
 * @property CustomerAddressType $address_type
 * @property string $delivery_area_id
 * @property string|null $label
 * @property string $line_one
 * @property string|null $line_two
 * @property string|null $building
 * @property string|null $floor
 * @property string|null $apartment
 * @property string|null $directions
 * @property string|null $postal_code
 * @property string|null $contact_point_id
 * @property bool $is_default
 * @property string|null $created_by
 * @property string|null $updated_by
 * @property int $lock_version
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read CustomerAccount|null $customerAccount
 * @property-read DeliveryArea|null $deliveryArea
 */
#[Classified(DataClassification::Confidential, 'line_one', 'line_two', 'building', 'floor', 'apartment', 'directions', 'postal_code', 'label')]
class CustomerAddress extends BaseModel
{
    /** @use HasFactory<CustomerAddressFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'address_type' => CustomerAddressType::class,
            'is_default' => 'boolean',
            'lock_version' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<CustomerAccount, $this>
     */
    public function customerAccount(): BelongsTo
    {
        return $this->belongsTo(CustomerAccount::class);
    }

    /**
     * @return BelongsTo<DeliveryArea, $this>
     */
    public function deliveryArea(): BelongsTo
    {
        return $this->belongsTo(DeliveryArea::class);
    }

    /**
     * @return BelongsTo<ContactPoint, $this>
     */
    public function contactPoint(): BelongsTo
    {
        return $this->belongsTo(ContactPoint::class);
    }
}
