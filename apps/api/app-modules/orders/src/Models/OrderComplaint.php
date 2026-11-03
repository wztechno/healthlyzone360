<?php

declare(strict_types=1);

namespace Healthy360\Orders\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Something that went wrong with an order. See the table's migration.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $order_id
 * @property string $cause
 * @property string|null $description
 * @property int $cost_minor
 * @property string $currency_code
 * @property string|null $outcome null while open
 * @property string|null $remake_order_id
 * @property string|null $order_refund_id
 * @property string $created_by
 * @property string|null $closed_by
 * @property CarbonImmutable|null $closed_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read Order|null $order
 * @property-read Order|null $remakeOrder
 */
#[Classified(DataClassification::Internal, 'cause', 'description', 'cost_minor', 'currency_code', 'outcome', 'order_id', 'remake_order_id', 'order_refund_id', 'created_by', 'closed_by', 'closed_at')]
class OrderComplaint extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    public const array CAUSES = ['wrong_item', 'missing_item', 'quality', 'late', 'foreign_object', 'other'];

    public const array OUTCOMES = ['remade', 'refunded', 'apologised', 'no_action'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'cost_minor' => 'integer',
            'closed_at' => 'immutable_datetime',
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
     * @return BelongsTo<Order, $this>
     */
    public function remakeOrder(): BelongsTo
    {
        return $this->belongsTo(Order::class, 'remake_order_id');
    }
}
