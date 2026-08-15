<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Models;

use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Support\Carbon;

/**
 * The weighted moving-average cost of one ingredient to one organisation
 * (INV1.1) — a current value, rewritten on every priced purchase.
 *
 * `moving_average_cost_amount` is expressed per `unit_id`, which is always the
 * ingredient's own `default_unit_id`; `quantity_on_hand` is the basis quantity
 * the average is weighted over, in that same unit. INV1.2's consume path reads
 * `moving_average_cost_amount` to value COGS and lowers `quantity_on_hand`; it
 * never rewrites the average.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $ingredient_id
 * @property string $unit_id
 * @property numeric-string $quantity_on_hand
 * @property numeric-string|null $moving_average_cost_amount
 * @property numeric-string|null $last_purchase_cost_amount
 * @property string|null $currency_code
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
class IngredientStockCost extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    protected function casts(): array
    {
        return [
            'quantity_on_hand' => 'decimal:6',
            'moving_average_cost_amount' => 'decimal:6',
            'last_purchase_cost_amount' => 'decimal:6',
        ];
    }
}
