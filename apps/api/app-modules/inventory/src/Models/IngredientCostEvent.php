<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Models;

use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Support\Carbon;

/**
 * One immutable entry in the ingredient cost ledger (INV1.1) — the append-only
 * record behind every moving-average figure. A REVOKE migration takes UPDATE
 * and DELETE from the runtime roles, so a row here is never rewritten.
 *
 * Each row is one priced goods-receipt line, blended into the average: the
 * quantity and unit cost received (in `unit_id`, the ingredient's default
 * unit), the line total and currency, and the average and basis quantity that
 * resulted.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $ingredient_id
 * @property string|null $source_receipt_line_id
 * @property string $unit_id
 * @property numeric-string $quantity
 * @property numeric-string $unit_cost_amount
 * @property numeric-string $line_total_amount
 * @property string $currency_code
 * @property numeric-string $resulting_average_amount
 * @property numeric-string $resulting_quantity
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
class IngredientCostEvent extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    protected function casts(): array
    {
        return [
            'quantity' => 'decimal:6',
            'unit_cost_amount' => 'decimal:6',
            'line_total_amount' => 'decimal:6',
            'resulting_average_amount' => 'decimal:6',
            'resulting_quantity' => 'decimal:6',
        ];
    }
}
