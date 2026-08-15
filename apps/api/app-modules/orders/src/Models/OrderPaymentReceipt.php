<?php

declare(strict_types=1);

namespace Healthy360\Orders\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Orders\Database\Factories\OrderPaymentReceiptFactory;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One statement that money arrived against one order.
 *
 * A receipt is written when a desk takes payment, and it is the only place this
 * platform records that a payment happened outside the `payment_intents` flow.
 * **An order carries intents or receipts, never both**: the desk never creates
 * an intent, so the two paths are disjoint by construction rather than by
 * constraint (the migration argues it at length).
 *
 * **Whether an order is paid is a sum over these rows**, computed on read —
 * `SUM(amount_minor) >= orders.total_minor` — and stored nowhere. Several
 * receipts may hang off one order and their sum may exceed its total; a
 * deposit and a balance are two rows, and change given from the till is not a
 * row at all.
 *
 * **Append-only by convention**: no update path, no delete path, and no
 * negative amount. Money arriving is not an event that un-happens, and giving
 * it back is the payments module's act in the payments module's table.
 *
 * **Deliberately not `OrganisationScoped`**, matching `Order` and `OrderLine`
 * rather than `PaymentIntent`. A receipt is never queried on its own: every
 * reader arrives holding an order that `OrderQuery::forSeller()` already
 * filtered, and the aggregate the desk queue runs is keyed on a page of order
 * ids that were scoped before it ran. An ambient scope here would add a second
 * organisation predicate to a query that already has the right one, and would
 * throw for want of a tenant in the sweeps that legitimately run without one.
 *
 * `reference` and `notes` are `Confidential`: a transfer identifier points at
 * a real transaction between two named parties, and a free-text note written at
 * a counter is exactly where somebody puts a customer's name. `confirmed_by` is
 * `Internal` and is nonetheless an indirect personal identifier — it resolves
 * to a member of staff — which is why the data register flags this table for
 * PII on that column rather than treating a payment record as impersonal.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $order_id
 * @property PaymentMethod $method
 * @property int $amount_minor
 * @property string $currency_code
 * @property string|null $reference
 * @property string $confirmed_by
 * @property CarbonImmutable $confirmed_at
 * @property string|null $notes
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read Order|null $order
 * @property-read User|null $confirmedBy
 */
#[Classified(DataClassification::Confidential, 'reference', 'notes')]
#[Classified(DataClassification::Internal, 'method', 'amount_minor', 'currency_code', 'confirmed_by', 'confirmed_at')]
class OrderPaymentReceipt extends BaseModel
{
    /** @use HasFactory<OrderPaymentReceiptFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'method' => PaymentMethod::class,
            'amount_minor' => 'integer',
            'confirmed_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<Order, $this>
     */
    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    /**
     * The person who says the money arrived. The whole control on a WISH
     * receipt is that this is somebody, not something.
     *
     * @return BelongsTo<User, $this>
     */
    public function confirmedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'confirmed_by');
    }

    /**
     * @return BelongsTo<Organisation, $this>
     */
    public function organisation(): BelongsTo
    {
        return $this->belongsTo(Organisation::class);
    }
}
