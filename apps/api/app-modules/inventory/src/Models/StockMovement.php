<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Models;

use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Support\Carbon;

/**
 * One append-only entry in the stock ledger (INV1.0 revokes UPDATE/DELETE at
 * grant level, so a row here is never rewritten).
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $branch_id
 * @property string $stock_item_id
 * @property numeric-string $quantity_delta signed; negative removed stock
 * @property string $reason adjust | waste | receipt | consume | yield
 * @property string|null $reference_type
 * @property string|null $reference_id
 * @property string|null $order_line_id the order line a consume served, so COGS attributes per line/kind (INV1.5)
 * @property string|null $sold_item_type meal | product, denormalised from the sold catalogue item (INV1.5)
 * @property string|null $notes why a person moved it; required on an adjustment, and on waste whose reason is `other`
 * @property string|null $waste_reason expired | spoiled | damaged | overproduced | customer_return | other; waste only, and null before the column (read as `other`)
 * @property string|null $actor_user_id who moved it; null on a row from before the column, or a job with nobody signed in
 * @property numeric-string|null $unit_cost_amount moving-average cost at consume time, per the ingredient default unit (INV1.2)
 * @property numeric-string|null $cost_amount the value of this movement, unsigned (`quantity_delta` gives the direction): unit_cost × quantity consumed (INV1.2); on an `adjust` row, a count's value
 * @property string|null $cost_currency_code
 * @property Carbon $created_at
 * @property Carbon $updated_at
 */
class StockMovement extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    protected function casts(): array
    {
        return [
            'quantity_delta' => 'decimal:4',
            'unit_cost_amount' => 'decimal:6',
            'cost_amount' => 'decimal:6',
        ];
    }
}
