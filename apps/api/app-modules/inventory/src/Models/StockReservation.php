<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Models;

use Carbon\CarbonImmutable;
use Healthy360\Inventory\Enums\ReservationStatus;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Stock one holder has claimed and not yet taken (PROD1).
 *
 * `quantity` is in the stock item's own unit, exactly as `stock_levels.quantity`
 * is, so availability is a subtraction rather than a conversion.
 *
 * Unlike `stock_movements` this table **is** updatable: a claim's whole point is
 * that it ends, and ending it is a status change rather than a new row. That is
 * the difference between a ledger of what moved and a record of what is spoken
 * for.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $branch_id
 * @property string $stock_item_id
 * @property numeric-string $quantity in the stock item's unit
 * @property string $holder_type
 * @property string $holder_id
 * @property ReservationStatus $status
 * @property CarbonImmutable|null $released_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read StockItem|null $stockItem
 */
class StockReservation extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** The only holder there is today. Named so a second one has to be added deliberately. */
    public const string HOLDER_PRODUCTION_ORDER = 'production_order';

    protected function casts(): array
    {
        return [
            'quantity' => 'decimal:4',
            'status' => ReservationStatus::class,
            'released_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<StockItem, $this>
     */
    public function stockItem(): BelongsTo
    {
        return $this->belongsTo(StockItem::class);
    }
}
