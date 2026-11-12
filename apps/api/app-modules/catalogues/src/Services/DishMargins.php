<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Contracts\PackPriceRegistry;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\DishMargin;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Services\PackCost;
use Healthy360\Recipes\Services\WeeklyRecipeCostingService;
use Healthy360\ReferenceData\Models\Currency;
use Healthy360\Support\Alerts\StaffAlerts;
use Healthy360\Support\Alerts\StaffAlertType;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Support\Collection;

/**
 * What each pack of each dish on sale earns, per place, at what the kitchen is paying now.
 *
 * ## One row per item × pack × place (plan S7)
 *
 * A place is `home` (the web shop) or `business`; the counter charges the Home shop
 * price and has no rows of its own. A pack gets a row on a place when it carries a
 * price on that place's public tariff — its own, or the item's pack-less one it
 * inherits ({@see PackPriceRegistry}). The price is that amount in major units; the
 * cost is {@see PackCost} over the published version: the fill at the live production
 * cost, plus its packaging. A dish with no active pack or no published recipe, or
 * whose packs are priced nowhere, keeps one pack-less row saying so, because a staff
 * member needs to see it.
 *
 * ## Withheld, never guessed
 *
 * A margin over part of a cost reads like a whole one and is too high. So there is no
 * percentage when there is no published recipe (`no_recipe`), no pack (`no_pack`), no
 * price (`no_price`), a pack with no container yet (`packaging_unknown` — the price and
 * what the contents cost are still shown), any other incomplete cost (`cost_incomplete`),
 * or a price and a cost in two currencies (`currency_mismatch`). A dish with an empty
 * recipe stays on sale, by the owner's ruling, and lands here.
 *
 * ## The alert fires when the cost moved a row below target
 *
 * That is the ruling's wording, and it is what keeps the alert quiet. A row found low
 * because the owner just raised the target, because its price was cut, or on its first
 * run is flagged on the page and alerts nobody: otherwise setting a target would mail
 * the owner once per dish. `below_target_since` stops a row that stays low alerting
 * again, and clears when it recovers. A row whose cost went unknown is left as it was,
 * because nothing can be said about it.
 */
final readonly class DishMargins
{
    private const int WORKING_SCALE = 8;

    /** @var list<'home'|'business'> */
    private const array PLACES = ['home', 'business'];

    public function __construct(
        private WeeklyRecipeCostingService $costing,
        private PackCost $packCost,
        private PackPriceRegistry $packs,
        private KitchenServiceSettingsLookup $settings,
        private StaffAlerts $alerts,
    ) {}

    /**
     * Recost one kitchen's dishes. The caller sets the tenant context.
     */
    public function refresh(string $organisationId): void
    {
        $items = CatalogueItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('status', CatalogueItemStatus::Published->value)
            ->whereNotIn('item_type', self::unpricedTypes())
            ->get(['id', 'organisation_id', 'name_en', 'recipe_id', 'status', 'item_type']);

        $this->recost($organisationId, $items, DishMargin::withoutTenancy()->where('organisation_id', $organisationId)->get());
    }

    /**
     * Recost one item, as the nightly run would: after a packs write or a recipe
     * publication, so the page is current without waiting for the night. An item
     * off sale, or never priced here, loses its rows.
     */
    public function refreshItem(CatalogueItem $item): void
    {
        $organisationId = (string) $item->organisation_id;
        $sold = $item->status === CatalogueItemStatus::Published
            && ! in_array($item->item_type->value, self::unpricedTypes(), true);

        $this->recost(
            $organisationId,
            new EloquentCollection($sold ? [$item] : []),
            DishMargin::withoutTenancy()->where('catalogue_item_id', $item->getKey())->get(),
        );
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
     * @param  EloquentCollection<int, CatalogueItem>  $items
     * @param  EloquentCollection<int, DishMargin>  $rows  every row these items may have
     */
    private function recost(string $organisationId, EloquentCollection $items, EloquentCollection $rows): void
    {
        $now = CarbonImmutable::now();
        $target = $this->settings->for($organisationId)->dish_margin_target_percent;
        $existing = $rows->keyBy(static fn (DishMargin $row): string => self::key($row->catalogue_item_id, $row->catalogue_item_variant_id, $row->channel));

        /** @var array<string, int> $minorUnits */
        $minorUnits = Currency::query()->pluck('minor_units', 'code')->map(static fn (mixed $units): int => (int) $units)->all();

        $kept = [];

        foreach ($items as $item) {
            foreach ($this->figures($organisationId, $item, $minorUnits) as $figures) {
                $key = self::key((string) $item->getKey(), $figures['pack_id'], $figures['place']);
                $kept[] = $key;
                $this->store($item, $figures, $existing->get($key), $target, $now);
            }
        }

        $this->dropStale($existing, $kept);
    }

    /**
     * Each pack on each place it is priced on, or the one pack-less row saying why there is none.
     *
     * @param  array<string, int>  $minorUnits
     * @return list<array{pack_id: string|null, pack_label: string|null, place: string, price: numeric-string|null, contents: numeric-string|null, cost: numeric-string|null, currency: string|null, margin: numeric-string|null, reason: string|null}>
     */
    private function figures(string $organisationId, CatalogueItem $item, array $minorUnits): array
    {
        $version = $item->recipe_id === null ? null : RecipeVersion::query()
            ->where('recipe_id', $item->recipe_id)
            ->where('status', RecipeVersionStatus::Published->value)
            ->first();

        if (! $version instanceof RecipeVersion) {
            return [$this->withheld(null, null, 'home', 'no_recipe')];
        }

        $packs = $this->packs->packPricesOf($item);

        if ($packs === []) {
            return [$this->withheld(null, null, 'home', 'no_pack')];
        }

        // Formulation only: a pack brings its own packaging, never the version's — PackCost::forVersion's call.
        $production = $this->costing->cost($organisationId, $version, null, new EloquentCollection)->production;
        $costs = collect($this->packCost->of($organisationId, $production, array_map(static fn (array $pack): array => [
            'key' => $pack['id'],
            'fill_quantity' => $pack['fill']['quantity'],
            'fill_unit' => $pack['fill']['unit'],
            'components' => $pack['components'],
        ], $packs)))->keyBy('key');

        $figures = [];

        foreach ($packs as $pack) {
            $label = $pack['name_en'] ?? $pack['code'];
            $cost = $costs->get($pack['id']);

            foreach (self::PLACES as $place) {
                $price = $pack['prices'][$place];

                // A zero is not a price a margin can be taken over.
                if ($price === null || $price['amount_minor'] <= 0) {
                    continue;
                }

                $currency = $price['currency_code'];
                $amount = bcdiv((string) $price['amount_minor'], bcpow('10', (string) ($minorUnits[$currency] ?? 2), 0), 6);
                $row = [
                    ...$this->withheld($pack['id'], $label, $place, null),
                    'price' => $amount,
                    'contents' => $cost['contents_amount'] ?? null,
                    'currency' => $currency,
                ];

                $reason = $cost['withheld_reason'] ?? 'cost_incomplete';

                if ($cost === null || $cost['cost_amount'] === null) {
                    $figures[] = [...$row, 'reason' => $reason === PackCost::PACKAGING_UNKNOWN ? 'packaging_unknown' : 'cost_incomplete'];
                } elseif ($currency !== $production->currencyCode) {
                    $figures[] = [...$row, 'cost' => $cost['cost_amount'], 'currency' => null, 'reason' => 'currency_mismatch'];
                } else {
                    $figures[] = [
                        ...$row,
                        'cost' => $cost['cost_amount'],
                        'margin' => bcmul(bcdiv(bcsub($amount, $cost['cost_amount'], self::WORKING_SCALE), $amount, self::WORKING_SCALE), '100', 2),
                    ];
                }
            }
        }

        return $figures === [] ? [$this->withheld(null, null, 'home', 'no_price')] : $figures;
    }

    /**
     * @return array{pack_id: string|null, pack_label: string|null, place: string, price: null, contents: null, cost: null, currency: null, margin: null, reason: string|null}
     */
    private function withheld(?string $packId, ?string $packLabel, string $place, ?string $reason): array
    {
        return [
            'pack_id' => $packId,
            'pack_label' => $packLabel,
            'place' => $place,
            'price' => null,
            'contents' => null,
            'cost' => null,
            'currency' => null,
            'margin' => null,
            'reason' => $reason,
        ];
    }

    /**
     * @param  array{pack_id: string|null, pack_label: string|null, place: string, price: numeric-string|null, contents: numeric-string|null, cost: numeric-string|null, currency: string|null, margin: numeric-string|null, reason: string|null}  $figures
     */
    private function store(CatalogueItem $item, array $figures, ?DishMargin $previous, ?int $target, CarbonImmutable $now): void
    {
        $row = $previous ?? new DishMargin([
            'organisation_id' => $item->organisation_id,
            'catalogue_item_id' => (string) $item->getKey(),
            'catalogue_item_variant_id' => $figures['pack_id'],
            'channel' => $figures['place'],
        ]);

        $lastCost = $previous?->cost_amount;

        $row->pack_label = $figures['pack_label'];
        $row->price_amount = $figures['price'];
        $row->contents_amount = $figures['contents'];
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
                'order_number' => $figures['pack_label'] === null ? $item->name_en : $item->name_en.' — '.$figures['pack_label'],
            ]);
        }
    }

    /**
     * A pack taken off sale or unpriced, or a dish off sale, leaves the page.
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

    private static function key(string $itemId, ?string $packId, string $place): string
    {
        return $itemId.'|'.($packId ?? '').'|'.$place;
    }

    /**
     * @return list<string>
     */
    private static function unpricedTypes(): array
    {
        return [CatalogueItemType::Product->value, CatalogueItemType::SubscriptionPlan->value];
    }
}
