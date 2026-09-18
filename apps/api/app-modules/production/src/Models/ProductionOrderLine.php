<?php

declare(strict_types=1);

namespace Healthy360\Production\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One shelf a batch draws on, as it was planned and as it turned out (PROD1).
 *
 * Written once at confirm from the explosion, then filled in at completion. The
 * plan half never moves again: it is what the kitchen committed to, what the
 * reservations were opened against, and what the estimated cost was computed
 * from, and re-deriving it later would make all three disagree.
 *
 * **`consumed_quantity` and `waste_quantity` do not overlap.** The shelf falls by
 * their sum, as two movements with different reasons: what went into the batch is
 * cost of goods, and what was dropped on the floor is waste. Folding the second
 * into the first would put the loss into the batch's unit cost, where the monthly
 * report would read it as the price of the food.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $production_order_id
 * @property string $stock_item_id
 * @property string $ingredient_id
 * @property string $line_kind ingredient | packaging
 * @property string|null $source_recipe_version_id the version that costed a produced component
 * @property numeric-string $required_quantity
 * @property string $unit_id
 * @property numeric-string|null $reserved_quantity
 * @property numeric-string|null $consumed_quantity
 * @property numeric-string|null $waste_quantity
 * @property numeric-string|null $estimated_unit_cost_amount
 * @property string|null $cost_source weekly | component | fallback
 * @property numeric-string|null $fallback_unit_cost_amount
 * @property numeric-string|null $actual_unit_cost_amount
 * @property string|null $cost_currency_code
 * @property CarbonImmutable|null $valued_at
 * @property int $display_order
 * @property CarbonImmutable $created_at
 * @property CarbonImmutable $updated_at
 * @property-read ProductionOrder|null $productionOrder
 */
class ProductionOrderLine extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    public const string KIND_INGREDIENT = 'ingredient';

    public const string KIND_PACKAGING = 'packaging';

    /** The estimate stood on a published weekly purchase price. */
    public const string SOURCE_WEEKLY = 'weekly';

    /** The estimate stood on the recipe that makes this produced component. */
    public const string SOURCE_COMPONENT = 'component';

    /** No weekly price existed; the ingredient's own recorded cost was used, and said so. */
    public const string SOURCE_FALLBACK = 'fallback';

    protected function casts(): array
    {
        return [
            'required_quantity' => 'decimal:4',
            'reserved_quantity' => 'decimal:4',
            'consumed_quantity' => 'decimal:4',
            'waste_quantity' => 'decimal:4',
            'estimated_unit_cost_amount' => 'decimal:6',
            'fallback_unit_cost_amount' => 'decimal:6',
            'actual_unit_cost_amount' => 'decimal:6',
            'valued_at' => 'immutable_datetime',
            'display_order' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<ProductionOrder, $this>
     */
    public function productionOrder(): BelongsTo
    {
        return $this->belongsTo(ProductionOrder::class);
    }

    /**
     * How much left the shelf for this line: what went in plus what was dropped.
     *
     * Null while the batch is still cooking — nothing has been reported yet, which
     * is not the same as nothing having moved.
     *
     * @return numeric-string|null
     */
    public function totalRemovedQuantity(): ?string
    {
        if ($this->consumed_quantity === null && $this->waste_quantity === null) {
            return null;
        }

        return bcadd(
            (string) ($this->consumed_quantity ?? '0'),
            (string) ($this->waste_quantity ?? '0'),
            4,
        );
    }
}
