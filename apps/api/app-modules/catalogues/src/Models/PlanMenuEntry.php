<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Models;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Database\Factories\PlanMenuEntryFactory;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One dish, in one slot, on one day of a fixed-menu plan's cycle.
 *
 * **The cycle is anchored to the plan, not to the subscriber.** Day 3 of a
 * 7-day cycle is the same calendar Wednesday for everybody on the plan,
 * whether they joined in January or yesterday. The alternative — anchoring
 * each subscriber to their own start date — was rejected, and the reason is
 * the kitchen rather than the arithmetic:
 *
 *  * **One production run per day.** Plan-anchored, a Wednesday is "180
 *    portions of the chicken". Subscriber-anchored, the same Wednesday is
 *    every dish on the menu at once, in whatever proportions this month's
 *    sign-up dates happen to produce — which is not a menu, it is an à la
 *    carte service with extra steps.
 *  * **Forecasts become a sum instead of a simulation.** "What do we buy for
 *    next week" is the menu's own days multiplied by a headcount, and
 *    aggregating it needs no per-subscriber walk at all. Subscriber-anchored,
 *    the same question requires replaying every subscription's own offset.
 *  * **A customer can be told what is for dinner on Thursday.** One answer,
 *    printable, the same on the website and on the kitchen wall.
 *
 * What it costs is that a subscriber joining on cycle day 5 gets days 5, 6, 7,
 * 1, 2 … rather than starting at day 1. For a fixed menu that is what a fixed
 * menu means — the kitchen cooks what it cooks — and the plans that want the
 * other behaviour are free-selection plans, which do not use this table.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $catalogue_item_id the plan
 * @property int $cycle_day
 * @property string $slot
 * @property int $sequence
 * @property string $meal_catalogue_item_id the dish
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read CatalogueItem|null $plan
 * @property-read CatalogueItem|null $meal
 */
#[Classified(DataClassification::Public, 'cycle_day', 'slot', 'sequence')]
class PlanMenuEntry extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<PlanMenuEntryFactory> */
    use HasFactory;

    /**
     * Which day of the cycle a given date falls on, 1-based.
     *
     * The double modulo is not decoration. PHP's `%` — and `diffInDays()` with
     * `absolute: false` — both keep the sign of the left operand, so a date
     * *before* the anchor produces a negative remainder: 2 days before the
     * anchor of a 7-day cycle gives `-2 % 7 = -2`, and `-2 + 1` is day −1,
     * which is not a day. Adding `$cycleDays` and taking the modulo again maps
     * every remainder into `0…n-1` before the 1-based `+ 1`, so the same
     * Wednesday resolves to the same dish whether it is read forwards from the
     * anchor or backwards from it.
     *
     * Pre-anchor dates are a real case, not a defensive one: a kitchen sets
     * today as the anchor and then asks what last week's deliveries were
     * against the menu, and a forecast whose window opens before the anchor
     * would otherwise index off the end of the menu.
     *
     * Both dates are compared as **dates**. The caller passes what it means by
     * "day" — the anchor column is a `date` for that reason — and the times of
     * day are dropped here rather than left to produce an off-by-one across a
     * DST boundary or a midnight.
     */
    public static function cycleDayFor(CarbonImmutable $date, CarbonImmutable $anchor, int $cycleDays): int
    {
        $elapsed = (int) $anchor->startOfDay()->diffInDays($date->startOfDay(), absolute: false);

        return (($elapsed % $cycleDays) + $cycleDays) % $cycleDays + 1;
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'cycle_day' => 'integer',
            'sequence' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<CatalogueItem, $this>
     */
    public function plan(): BelongsTo
    {
        return $this->belongsTo(CatalogueItem::class, 'catalogue_item_id');
    }

    /**
     * @return BelongsTo<CatalogueItem, $this>
     */
    public function meal(): BelongsTo
    {
        return $this->belongsTo(CatalogueItem::class, 'meal_catalogue_item_id');
    }
}
