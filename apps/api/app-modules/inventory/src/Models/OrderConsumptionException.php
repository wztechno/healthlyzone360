<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Models;

use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Support\Carbon;

/**
 * One thing a confirmed order could not deduct honestly (INV1.2).
 *
 * Written by `OrderConsumptionService` whenever a line's consumption cannot be
 * resolved without guessing — no published recipe version, no yield piece count,
 * no branch stock item, no convertible unit, no moving-average cost. The order
 * still confirms and whatever *was* resolvable is still deducted; this row is
 * the record that the rest was not, so the kitchen and INV1.4's report can tell
 * a complete deduction from a partial one.
 *
 * `order_id`, `order_line_id` and `catalogue_item_id` are soft references — see
 * the migration for why there are no foreign keys.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $order_id
 * @property string|null $order_line_id
 * @property string|null $catalogue_item_id
 * @property string $reason_code
 * @property string|null $detail
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
class OrderConsumptionException extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;
}
