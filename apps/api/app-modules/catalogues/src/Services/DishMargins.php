<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\DishMargin;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Services\WeeklyRecipeCostingService;
use Healthy360\Support\Alerts\StaffAlerts;
use Healthy360\Support\Alerts\StaffAlertType;
use Illuminate\Support\Collection;

/**
 * What each dish on sale earns, at what the kitchen is paying now.
 *
 * ## The figures are the technical sheet's
 *
 * The price is the list price on the published version, per unit of its yield. The
 * cost is {@see WeeklyRecipeCostingService}, the same call behind the sheet's weekly
 * block, per the same unit and including packaging. One recipe priced for diners and
 * for buyers gives one row each. A dish with neither price still gets a row saying
 * so, because a staff member needs to see it.
 *
 * ## Withheld, never guessed
 *
 * A margin over part of a recipe reads like a whole one and is too high, which is
 * Stage 2's rule for the month and the same rule here. So there is no percentage
 * when there is no published recipe, no list price, an incomplete cost (a recipe
 * with no lines costs nothing, which is not the same as being free), or a price and
 * a cost in two currencies. The reason is stored instead. A dish with an empty
 * recipe stays on sale, by the owner's ruling, and lands here.
 *
 * ## The alert fires when the cost moved a dish below target
 *
 * That is the ruling's wording, and it is what keeps the alert quiet. A dish found
 * low because the owner just raised the target, because its price was cut, or on its
 * first run is flagged on the page and alerts nobody: otherwise setting a target
 * would mail the owner once per dish. `below_target_since` stops a dish that stays
 * low alerting again, and clears when it recovers. A dish whose cost went unknown is
 * left as it was, because nothing can be said about it.
 */
final readonly class DishMargins
{
    private const int WORKING_SCALE = 8;

    public function __construct(
        private WeeklyRecipeCostingService $costing,
        private KitchenServiceSettingsLookup $settings,
        private StaffAlerts $alerts,
    ) {}

    /**
     * Recost one kitchen's dishes. The caller sets the tenant context.
     */
    public function refresh(string $organisationId): void
    {
        $now = CarbonImmutable::now();
        $target = $this->settings->for($organisationId)->dish_margin_target_percent;

        $items = CatalogueItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('status', CatalogueItemStatus::Published->value)
            ->whereNotIn('item_type', [CatalogueItemType::Product->value, CatalogueItemType::SubscriptionPlan->value])
            ->get(['id', 'organisation_id', 'name_en', 'recipe_id']);

        $existing = DishMargin::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->get()
            ->keyBy(static fn (DishMargin $row): string => $row->catalogue_item_id.'|'.$row->channel);

        $kept = [];

        foreach ($items as $item) {
            foreach ($this->figures($organisationId, $item) as $channel => $figures) {
                $key = $item->getKey().'|'.$channel;
                $kept[] = $key;
                $this->store($item, $channel, $figures, $existing->get($key), $target, $now);
            }
        }

        $this->dropStale($existing, $kept);
    }

    /**
     * @return Collection<int, DishMargin>
     */
    public function list(): Collection
    {
        return DishMargin::query()
            ->with('catalogueItem:id,name_en,name_ar,item_type')
            ->orderByRaw('margin_percent asc nulls last')
            ->orderBy('id')
            ->get();
    }

    /**
     * Each channel this dish is priced on, and one row if it is priced on neither.
     *
     * @return array<string, array{price: numeric-string|null, cost: numeric-string|null, currency: string|null, margin: numeric-string|null, reason: string|null}>
     */
    private function figures(string $organisationId, CatalogueItem $item): array
    {
        $version = $item->recipe_id === null ? null : RecipeVersion::query()
            ->where('recipe_id', $item->recipe_id)
            ->where('status', RecipeVersionStatus::Published->value)
            ->first();

        if (! $version instanceof RecipeVersion) {
            return ['b2c' => $this->withheld('no_recipe')];
        }

        $prices = array_filter(
            ['b2c' => $version->b2c_price_amount, 'b2b' => $version->b2b_price_amount],
            static fn (?string $price): bool => $price !== null && bccomp($price, '0', 6) > 0,
        );

        if ($prices === []) {
            return ['b2c' => $this->withheld('no_price')];
        }

        $computed = $this->costing->cost($organisationId, $version);
        $cost = $computed->totalCostPerYieldUnitAmount;
        $figures = [];

        foreach ($prices as $channel => $price) {
            if ($cost === null || $computed->production->lineCosts === []) {
                $figures[$channel] = [...$this->withheld('cost_incomplete'), 'price' => $price, 'currency' => $version->price_currency_code];
            } elseif ($version->price_currency_code !== $computed->production->currencyCode) {
                $figures[$channel] = [...$this->withheld('currency_mismatch'), 'price' => $price, 'cost' => $cost];
            } else {
                $figures[$channel] = [
                    'price' => $price,
                    'cost' => $cost,
                    'currency' => $version->price_currency_code,
                    'margin' => bcmul(bcdiv(bcsub($price, $cost, self::WORKING_SCALE), $price, self::WORKING_SCALE), '100', 2),
                    'reason' => null,
                ];
            }
        }

        return $figures;
    }

    /**
     * @return array{price: null, cost: null, currency: null, margin: null, reason: string}
     */
    private function withheld(string $reason): array
    {
        return ['price' => null, 'cost' => null, 'currency' => null, 'margin' => null, 'reason' => $reason];
    }

    /**
     * @param  array{price: numeric-string|null, cost: numeric-string|null, currency: string|null, margin: numeric-string|null, reason: string|null}  $figures
     */
    private function store(CatalogueItem $item, string $channel, array $figures, ?DishMargin $previous, ?int $target, CarbonImmutable $now): void
    {
        $row = $previous ?? new DishMargin([
            'organisation_id' => $item->organisation_id,
            'catalogue_item_id' => (string) $item->getKey(),
            'channel' => $channel,
        ]);

        $lastCost = $previous?->cost_amount;

        $row->price_amount = $figures['price'];
        $row->cost_amount = $figures['cost'];
        $row->currency_code = $figures['currency'];
        $row->margin_percent = $figures['margin'];
        $row->withheld_reason = $figures['reason'];
        $row->computed_at = $now;

        $fell = false;

        if ($figures['margin'] !== null) {
            $low = $target !== null && bccomp($figures['margin'], (string) $target, 2) < 0;

            $fell = $low && $row->below_target_since === null
                && $lastCost !== null && bccomp($figures['cost'] ?? '0', $lastCost, 6) > 0;

            $row->below_target_since = $low ? ($row->below_target_since ?? $now) : null;
        }

        $row->save();

        if ($fell) {
            $this->alerts->send(StaffAlertType::DishBelowTarget, $item->organisation_id, (string) $row->getKey(), [
                'order_number' => $item->name_en,
            ]);
        }
    }

    /**
     * A dish taken off sale, or priced differently, leaves the page.
     *
     * @param  Collection<string, DishMargin>  $existing
     * @param  list<string>  $kept
     */
    private function dropStale(Collection $existing, array $kept): void
    {
        // toBase(): an Eloquent collection's except() reads model keys, and would
        // match none of these and delete every row.
        $existing->toBase()->except($kept)->each(static fn (DishMargin $row): ?bool => $row->delete());
    }
}
