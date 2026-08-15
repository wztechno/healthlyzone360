<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;

/**
 * One thing a confirmed order could not deduct honestly (INV1.2), with the
 * resolution state INV1.5 gave it.
 *
 * Written by `OrderConsumptionService` whenever a line's consumption cannot be
 * resolved without guessing — no published recipe version, no yield piece count,
 * no branch stock item, no convertible unit, no moving-average cost. The order
 * still confirms and whatever *was* resolvable is still deducted; this row is
 * the record that the rest was not, so the kitchen and INV1.4's report can tell
 * a complete deduction from a partial one.
 *
 * **Unresolved means `resolved_at` is null** — the one predicate the review list,
 * the hub badge and the report's data-quality flag all read (INV1.5). A row is
 * settled either by a person marking it handled or by a retry that finds the line
 * now consumes cleanly.
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
 * @property CarbonImmutable|null $resolved_at
 * @property string|null $resolved_by
 * @property string|null $resolution_note
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
class OrderConsumptionException extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    protected function casts(): array
    {
        return [
            'resolved_at' => 'immutable_datetime',
        ];
    }

    /**
     * Still-open exceptions: those a person or a retry has not settled yet.
     *
     * @param  Builder<self>  $query
     * @return Builder<self>
     */
    public function scopeUnresolved(Builder $query): Builder
    {
        return $query->whereNull('resolved_at');
    }
}
