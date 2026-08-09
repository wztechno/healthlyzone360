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
 * @property string|null $notes
 * @property Carbon $created_at
 * @property Carbon $updated_at
 */
class StockMovement extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    protected function casts(): array
    {
        return ['quantity_delta' => 'decimal:4'];
    }
}
