<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Models;

use Carbon\CarbonImmutable;
use Healthy360\Procurement\Services\WeeklyPriceLookup;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One Monday's publication of weekly ingredient prices (PROD1) — the version a
 * production batch pins so that next week's prices cannot move last week's
 * estimate.
 *
 * Append-only. A recompute inserts a second publication naming the first in
 * `supersedes_id`; the current publication for a week is the newest by
 * `published_at`, derived rather than flagged, because flagging would need an
 * UPDATE the runtime role does not have.
 *
 * `has_late_receipts` is the one thing a publication learns about itself after
 * the fact — a delivery for its week posted after it was published — and it is
 * therefore **derived on read** by {@see WeeklyPriceLookup},
 * not stored. The column exists so a recompute can record what it found; a reader
 * asking "is this week's basis still what it was" gets the live answer.
 *
 * @property string $id
 * @property string $organisation_id
 * @property CarbonImmutable $purchase_week_start_date Monday of the averaged week, organisation-local
 * @property CarbonImmutable $purchase_week_end_date Sunday of the averaged week
 * @property CarbonImmutable $effective_from_date the Monday these prices take effect
 * @property string $timezone the clock the week boundaries were resolved in
 * @property CarbonImmutable $published_at
 * @property int $ingredient_count
 * @property int $computed_count
 * @property int $carried_count
 * @property int $unpriced_count
 * @property int $late_line_count
 * @property bool $has_late_receipts
 * @property string|null $supersedes_id
 * @property CarbonImmutable|null $created_at
 * @property-read Collection<int, IngredientWeeklyPrice> $prices
 */
class WeeklyPricePublication extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    public const UPDATED_AT = null;

    protected function casts(): array
    {
        return [
            'purchase_week_start_date' => 'immutable_date',
            'purchase_week_end_date' => 'immutable_date',
            'effective_from_date' => 'immutable_date',
            'published_at' => 'immutable_datetime',
            'has_late_receipts' => 'boolean',
        ];
    }

    /**
     * @return HasMany<IngredientWeeklyPrice, $this>
     */
    public function prices(): HasMany
    {
        return $this->hasMany(IngredientWeeklyPrice::class, 'weekly_price_publication_id');
    }
}
