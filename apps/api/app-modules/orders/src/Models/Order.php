<?php

declare(strict_types=1);

namespace Healthy360\Orders\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Orders\Database\Factories\OrderFactory;
use Healthy360\Orders\Enums\CancellationReason;
use Healthy360\Orders\Enums\FulfilmentType;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * What one customer bought from one kitchen.
 *
 * **Deliberately not `OrganisationScoped`**, the decision `CustomerAccount`
 * and `Cart` both record: the person who placed this order is a member of no
 * organisation, and an ambient organisation scope would hide their own order
 * from them or throw for want of a tenant. `organisation_id` still means the
 * seller and is still filtered explicitly — `OrderQuery::forSeller()` is the
 * only way a kitchen-facing reader gets rows, and it never forgets the filter
 * because there is no method that forgets it.
 *
 * The delivery columns are `Confidential`: a street address identifies a
 * person more reliably than their name does. The area *names* are not — a
 * district appears on the kitchen's own coverage map — which is why the split
 * is per column rather than per table.
 *
 * The amounts are `Internal`, not `Confidential`. What a customer was charged
 * is printed on their own receipt; what the food cost the kitchen is the
 * confidential figure, and no column here carries it.
 *
 * @property string $id
 * @property string $order_number
 * @property string $organisation_id
 * @property string|null $customer_account_id
 * @property string $sales_channel_id
 * @property string|null $b2b_agreement_id
 * @property string|null $price_list_id
 * @property string|null $branch_id
 * @property OrderStatus $status
 * @property string $currency_code
 * @property int $subtotal_minor
 * @property int|null $delivery_fee_minor
 * @property int $total_minor
 * @property FulfilmentType $fulfilment_type
 * @property string|null $delivery_label
 * @property string|null $delivery_line_one
 * @property string|null $delivery_line_two
 * @property string|null $delivery_city
 * @property string|null $delivery_area_name_en
 * @property string|null $delivery_area_name_ar
 * @property string|null $delivery_area_id
 * @property string|null $delivery_zone_id
 * @property string|null $delivery_building
 * @property string|null $delivery_floor
 * @property string|null $delivery_apartment
 * @property string|null $delivery_directions
 * @property string|null $delivery_contact_point_id
 * @property string|null $delivery_window_code
 * @property CarbonImmutable|null $requested_delivery_date
 * @property PaymentMethod $payment_method
 * @property CarbonImmutable $placed_at
 * @property CarbonImmutable|null $confirmed_at
 * @property CarbonImmutable|null $fulfilled_at
 * @property CarbonImmutable|null $cancelled_at
 * @property CancellationReason|null $cancellation_reason
 * @property string|null $created_by
 * @property string|null $placed_on_behalf_by
 * @property int $lock_version
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read Collection<int, OrderLine> $lines
 * @property-read Collection<int, OrderPaymentReceipt> $paymentReceipts
 * @property-read CustomerAccount|null $customerAccount
 */
#[Classified(DataClassification::Confidential, 'delivery_label', 'delivery_line_one', 'delivery_line_two', 'delivery_city', 'delivery_building', 'delivery_floor', 'delivery_apartment', 'delivery_directions')]
#[Classified(DataClassification::Internal, 'order_number', 'subtotal_minor', 'delivery_fee_minor', 'total_minor', 'status', 'fulfilment_type', 'delivery_window_code', 'requested_delivery_date')]
#[Classified(DataClassification::Public, 'delivery_area_name_en', 'delivery_area_name_ar')]
class Order extends BaseModel
{
    /** @use HasFactory<OrderFactory> */
    use HasFactory;

    /**
     * The column default, restated in the model.
     *
     * `orders.fulfilment_type` is NOT NULL `DEFAULT 'delivery'`, so a row
     * inserted without it is a delivery order — but the *model* that inserted
     * it would not know that until it was reloaded, and the placement path
     * presents the order it just saved rather than re-reading it. Without this,
     * `$order->fulfilment_type` is null on exactly that in-memory model and the
     * presenter serves null for a column that cannot hold one.
     *
     * Mass assignment is otherwise unrestricted — `BaseModel` guards nothing,
     * because every write flows through a module service — so this is the only
     * shape declaration the model needs.
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'fulfilment_type' => 'delivery',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => OrderStatus::class,
            'fulfilment_type' => FulfilmentType::class,
            'payment_method' => PaymentMethod::class,
            'cancellation_reason' => CancellationReason::class,
            'subtotal_minor' => 'integer',
            'delivery_fee_minor' => 'integer',
            'total_minor' => 'integer',
            'requested_delivery_date' => 'immutable_date',
            'placed_at' => 'immutable_datetime',
            'confirmed_at' => 'immutable_datetime',
            'fulfilled_at' => 'immutable_datetime',
            'cancelled_at' => 'immutable_datetime',
            'lock_version' => 'integer',
        ];
    }

    /**
     * @return HasMany<OrderLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(OrderLine::class);
    }

    /**
     * Every statement that money arrived against this order. Whether it is paid
     * is the sum of them against `total_minor`, never a column.
     *
     * @return HasMany<OrderPaymentReceipt, $this>
     */
    public function paymentReceipts(): HasMany
    {
        return $this->hasMany(OrderPaymentReceipt::class);
    }

    /**
     * @return BelongsTo<CustomerAccount, $this>
     */
    public function customerAccount(): BelongsTo
    {
        return $this->belongsTo(CustomerAccount::class);
    }

    /**
     * @return BelongsTo<Organisation, $this>
     */
    public function organisation(): BelongsTo
    {
        return $this->belongsTo(Organisation::class);
    }

    /**
     * @return BelongsTo<OrganisationBranch, $this>
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(OrganisationBranch::class, 'branch_id');
    }

    /**
     * @return BelongsTo<SalesChannel, $this>
     */
    public function salesChannel(): BelongsTo
    {
        return $this->belongsTo(SalesChannel::class, 'sales_channel_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * The member of staff who took this order **for** somebody else.
     *
     * Deliberately a second relation rather than a reading of `creator()`.
     * `created_by` is written on every path — a customer placing their own
     * order writes their own user id there — so "was this placed by staff" is
     * not answerable from it without asking whether that user happens to be an
     * employee. This one is null on every self-service order by construction.
     *
     * @return BelongsTo<User, $this>
     */
    public function placedOnBehalfBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'placed_on_behalf_by');
    }

    public function isOpen(): bool
    {
        return $this->status->isOpen();
    }
}
