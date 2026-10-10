<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Models;

use Carbon\CarbonImmutable;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Procurement\Enums\WeeklyPriceCarryReason;
use Healthy360\Procurement\Enums\WeeklyPriceSource;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * What one ingredient cost, on average, over one completed purchase week (PROD1).
 *
 * `average_unit_amount` is per `unit_id`, which is the ingredient's default unit
 * **as it was when the row was published** — stored rather than read back from
 * the ingredient, because a price per unit is meaningless without the unit it is
 * per and that unit can move underneath a published figure.
 *
 * Append-only. The standing price for an ingredient is the newest row by
 * `effective_from_date`, then the publication's `published_at`, then `id`; there
 * is no `effective_to_date` to close, because closing one would need an UPDATE
 * the runtime role does not have.
 *
 * A row with `source = unpriced` carries no amount, no currency and no unit. That
 * is the honest shape of "nobody has ever bought this at a recorded price" and it
 * is deliberately not zero — a free ingredient and an unknown one would otherwise
 * cost a recipe identically.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $weekly_price_publication_id
 * @property string $ingredient_id
 * @property CarbonImmutable $purchase_week_start_date
 * @property CarbonImmutable $purchase_week_end_date
 * @property CarbonImmutable $effective_from_date
 * @property string|null $unit_id the unit the average is per; null only when unpriced
 * @property numeric-string|null $average_unit_amount major currency units (§4.4), never minor
 * @property string|null $currency_code
 * @property numeric-string|null $total_quantity the average's denominator, in unit_id
 * @property numeric-string|null $total_cost_amount the average's numerator
 * @property int $receipt_line_count
 * @property int $unpriced_line_count
 * @property bool $has_unpriced_lines
 * @property WeeklyPriceSource $source
 * @property WeeklyPriceCarryReason|null $carry_reason
 * @property CarbonImmutable|null $carried_from_week_start_date
 * @property CarbonImmutable|null $created_at
 * @property-read Ingredient|null $ingredient
 * @property-read MeasurementUnit|null $unit
 * @property-read WeeklyPricePublication|null $publication
 */
#[Classified(DataClassification::Confidential, 'average_unit_amount', 'total_cost_amount')]
class IngredientWeeklyPrice extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    public const UPDATED_AT = null;

    protected function casts(): array
    {
        return [
            'purchase_week_start_date' => 'immutable_date',
            'purchase_week_end_date' => 'immutable_date',
            'effective_from_date' => 'immutable_date',
            'carried_from_week_start_date' => 'immutable_date',
            'average_unit_amount' => 'decimal:6',
            'total_quantity' => 'decimal:6',
            'total_cost_amount' => 'decimal:6',
            'has_unpriced_lines' => 'boolean',
            'source' => WeeklyPriceSource::class,
            'carry_reason' => WeeklyPriceCarryReason::class,
        ];
    }

    /**
     * @return BelongsTo<Ingredient, $this>
     */
    public function ingredient(): BelongsTo
    {
        return $this->belongsTo(Ingredient::class);
    }

    /**
     * @return BelongsTo<MeasurementUnit, $this>
     */
    public function unit(): BelongsTo
    {
        return $this->belongsTo(MeasurementUnit::class, 'unit_id');
    }

    /**
     * @return BelongsTo<WeeklyPricePublication, $this>
     */
    public function publication(): BelongsTo
    {
        return $this->belongsTo(WeeklyPricePublication::class, 'weekly_price_publication_id');
    }
}
