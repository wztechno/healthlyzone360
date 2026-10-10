<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;

/**
 * What one sold line was estimated to cost, frozen at confirm (PROD1).
 *
 * The monthly report's **estimated** margin reads these rows; its **actual**
 * margin reads the consume movements' moving-average valuation. Two figures over
 * the same sold quantities, and the gap between them is the thing a kitchen
 * actually wants to know.
 *
 * A line with no row here had no computable estimate — no recipe, no price, two
 * currencies — and the report counts those absences rather than summing them as
 * zero. Writing a zero would make the estimated margin read high and complete.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $order_id
 * @property string $order_line_id
 * @property numeric-string $estimated_cost_amount
 * @property string $currency_code
 * @property string|null $weekly_price_publication_id soft reference; the price basis the estimate stood on
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class OrderLineEstimatedCost extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    protected function casts(): array
    {
        return [
            'estimated_cost_amount' => 'decimal:6',
        ];
    }
}
