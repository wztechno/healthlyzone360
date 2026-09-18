<?php

declare(strict_types=1);

namespace Healthy360\Production\Models;

use Carbon\CarbonImmutable;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Production\Enums\ProductionOrderStatus;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One batch: what a kitchen committed to making, what it claimed to make it with,
 * and what actually came out (PROD1).
 *
 * ## Three figures are computed here and stored nowhere
 *
 * {@see usableYieldQuantity()} is produced minus rejected, {@see yieldVariance()}
 * is produced minus planned, and {@see isExpired()} is a comparison against today.
 * Each is a pure function of columns on this row, and a stored copy would be a
 * second answer to a question the row already answers — wrong the first time
 * anything but its own writer moved an input. The same discipline
 * `order_payment_receipts` applies to "is it paid".
 *
 * ## Rejected units are inside produced, never beside it
 *
 * A batch that made 38 and threw one away produced 38 and has 37 usable. The
 * whole 38 posts as a `yield` movement and the one rejected leaves again as
 * `waste` at the batch unit cost, so the shelf nets to 37 and the money follows
 * the unit rather than vanishing. Treating rejected as a separate output would
 * make the batch look like it produced 39.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $branch_id
 * @property string $recipe_version_id
 * @property ProductionOrderStatus $status
 * @property string|null $reference the kitchen-facing batch number
 * @property string|null $production_item_ingredient_id what the batch makes
 * @property numeric-string|null $planned_yield how much it is meant to make, in planned_yield_unit_id
 * @property string|null $planned_yield_unit_id
 * @property numeric-string|null $batch_factor how many times over the recipe is made
 * @property numeric-string|null $produced_quantity what came out, including anything later rejected
 * @property numeric-string|null $rejected_quantity produced and then discarded
 * @property CarbonImmutable|null $production_date branch-local business date
 * @property string|null $batch_reference what the cook writes on the label
 * @property string|null $storage_location
 * @property CarbonImmutable|null $expiry_date
 * @property numeric-string|null $estimated_cost_amount
 * @property string|null $estimated_cost_currency_code
 * @property string|null $weekly_price_publication_id soft reference; the price basis the estimate used
 * @property array<string, mixed>|null $nutrition_facts snapshotted at confirm
 * @property numeric-string|null $actual_cost_amount
 * @property string|null $actual_cost_currency_code
 * @property numeric-string|null $actual_unit_cost_amount withheld unless actual_cost_status is complete
 * @property string|null $actual_cost_status complete | partial | unvalued
 * @property string|null $valuation_note
 * @property CarbonImmutable|null $confirmed_at
 * @property CarbonImmutable|null $started_at
 * @property CarbonImmutable|null $completed_at
 * @property CarbonImmutable|null $cancelled_at
 * @property CarbonImmutable|null $abandoned_at
 * @property string|null $abandon_reason
 * @property string|null $created_by
 * @property int $lock_version
 * @property string|null $notes
 * @property CarbonImmutable $created_at
 * @property CarbonImmutable $updated_at
 * @property-read Collection<int, ProductionOrderLine> $lines
 */
class ProductionOrder extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** What `stock_movements.reference_type` carries for every movement this batch makes. */
    public const string MOVEMENT_REFERENCE = 'production_order';

    /** `actual_cost_status` when every input was valued and the arithmetic completed. */
    public const string COST_COMPLETE = 'complete';

    /** At least one input contributed quantity and no money. */
    public const string COST_PARTIAL = 'partial';

    /** Nothing could be summed — two currencies, or no valued input at all. */
    public const string COST_UNVALUED = 'unvalued';

    protected function casts(): array
    {
        return [
            'status' => ProductionOrderStatus::class,
            'planned_yield' => 'decimal:4',
            'batch_factor' => 'decimal:6',
            'produced_quantity' => 'decimal:4',
            'rejected_quantity' => 'decimal:4',
            'production_date' => 'immutable_date',
            'expiry_date' => 'immutable_date',
            'estimated_cost_amount' => 'decimal:6',
            'actual_cost_amount' => 'decimal:6',
            'actual_unit_cost_amount' => 'decimal:6',
            'nutrition_facts' => 'array',
            'confirmed_at' => 'immutable_datetime',
            'started_at' => 'immutable_datetime',
            'completed_at' => 'immutable_datetime',
            'cancelled_at' => 'immutable_datetime',
            'abandoned_at' => 'immutable_datetime',
            'lock_version' => 'integer',
        ];
    }

    /**
     * @return HasMany<ProductionOrderLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(ProductionOrderLine::class);
    }

    /**
     * What the batch makes.
     *
     * Eager-loaded by the desk so a queue of fifty batches costs one extra query
     * rather than fifty: a list that showed a uuid where a name belongs is a list
     * nobody can work from, and resolving the name per row is how that becomes an
     * N+1 on the surface a kitchen refreshes all day.
     *
     * @return BelongsTo<Ingredient, $this>
     */
    public function productionItem(): BelongsTo
    {
        return $this->belongsTo(Ingredient::class, 'production_item_ingredient_id');
    }

    /**
     * The unit the planned and produced quantities are in.
     *
     * @return BelongsTo<MeasurementUnit, $this>
     */
    public function plannedYieldUnit(): BelongsTo
    {
        return $this->belongsTo(MeasurementUnit::class, 'planned_yield_unit_id');
    }

    /**
     * What is actually on the shelf from this batch: produced minus rejected.
     *
     * Null when nothing has been produced yet — which is a different answer from
     * zero, and the difference is the whole reason this is nullable. A batch
     * mid-cook has no usable yield *yet*; a batch that produced nothing has none
     * at all.
     *
     * @return numeric-string|null
     */
    public function usableYieldQuantity(): ?string
    {
        if ($this->produced_quantity === null) {
            return null;
        }

        return bcsub((string) $this->produced_quantity, (string) ($this->rejected_quantity ?? '0'), 4);
    }

    /**
     * Produced minus planned — process loss when negative, over-run when positive.
     *
     * No money figure accompanies it, deliberately. Process loss is evaporation
     * and pot residue: it never existed as stock, so it has no cost of its own,
     * and its cost is already absorbed into the unit cost of what *was* produced.
     * Inventing a number for it would double-count the batch.
     *
     * @return numeric-string|null
     */
    public function yieldVariance(): ?string
    {
        if ($this->produced_quantity === null || $this->planned_yield === null) {
            return null;
        }

        return bcsub((string) $this->produced_quantity, (string) $this->planned_yield, 4);
    }

    /**
     * Whether the batch on the shelf is past its date.
     *
     * A batch with no expiry date is not expired — that is "nobody recorded one",
     * which is never the same as "it is fine", and the register says so by showing
     * the em dash rather than a reassuring answer.
     */
    public function isExpired(?CarbonImmutable $asOf = null): bool
    {
        if ($this->expiry_date === null) {
            return false;
        }

        return $this->expiry_date->lessThan(($asOf ?? CarbonImmutable::now())->startOfDay());
    }
}
