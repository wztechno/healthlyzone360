<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Presenters;

use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Kitchens\Models\BranchOpeningHour;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\ReferenceData\Models\DeliveryArea;

/**
 * The public projection of a kitchen (master plan v2 §4.8).
 *
 * ## The denylist is honoured by construction
 *
 * Nothing here can reach a cost, a margin, a supplier, a recipe line, a data
 * quality note or a document path, because this class is handed an
 * `Organisation`, its branches, its zones and its opening hours — and no other
 * row. The projection is not a filter over a wider shape; it is a
 * hand-written shape built from named columns.
 *
 * ## Fields the platform has no data for, and what they carry
 *
 * The consumer contract was written against a fixture world with richer
 * marketing content than the schema holds. Every gap is stated rather than
 * filled:
 *
 * | field                  | what it carries | why |
 * |------------------------|-----------------|-----|
 * | `tagline`, `description` | `''`          | `organisations` has no marketing copy. An empty string renders as nothing; an invented sentence would render as the kitchen's own words. |
 * | `cuisines`             | `[]`            | Nothing records how a kitchen cooks. |
 * | `rating`               | `null`          | No reviews exist. `null` is the contract's "too few ratings to average", which is true of zero. |
 * | `rating_count`         | `0`             | |
 * | `is_verified`          | `false`         | There is no verification module (J1 owns it). The platform has verified nobody, so `false` is the fact rather than a placeholder. |
 * | `supports_pickup`      | `false`         | No column records a pickup arrangement anywhere. See `MarketplaceChannels`. |
 *
 * `image_placeholder_id` is derived from the slug — `kitchen-<slug>` — which is
 * precisely what the contract asks for: "a generated placeholder identifier,
 * never a remote image URL".
 *
 * ## Names
 *
 * `organisations.name` is a **single** column, not a bilingual pair, so a
 * kitchen's own name is served as it was registered whatever `Accept-Language`
 * says. That is deliberate on the platform's side — a business name is not
 * translated — and it is the one name on these endpoints that the locale does
 * not touch. Everything the locale *does* touch (delivery-zone names, area
 * names) carries one server-chosen language and never both columns.
 */
final class MarketplaceKitchenPresenter
{
    /**
     * @param  list<string>  $dietClassifications
     * @param  array{b2c: bool, b2b: bool, marketplace: bool, pos: bool, subscription: bool, delivery: bool, pickup: bool, corporate: bool}  $channels
     * @param  list<array{branch: OrganisationBranch, zones: list<array{zone: DeliveryZone, areas: list<DeliveryArea>}>, hours: list<BranchOpeningHour>}>  $branches
     * @return array<string, mixed>
     */
    public function kitchen(
        Organisation $kitchen,
        string $locale,
        array $dietClassifications,
        array $channels,
        array $branches,
    ): array {
        return [
            'id' => (string) $kitchen->getKey(),
            'name' => $kitchen->name,
            'slug' => $kitchen->slug,
            'tagline' => '',
            'description' => '',
            'country_code' => $kitchen->country_code,
            'cuisines' => [],
            'diet_classifications' => $dietClassifications,
            'channels' => $channels,
            'branches' => array_map(
                fn (array $branch): array => $this->branch(
                    $branch['branch'],
                    (string) $kitchen->getKey(),
                    $locale,
                    $branch['zones'],
                    $branch['hours'],
                ),
                $branches,
            ),
            'rating' => null,
            'rating_count' => 0,
            'image_placeholder_id' => 'kitchen-'.$kitchen->slug,
            'is_verified' => false,
        ];
    }

    /**
     * @param  list<array{zone: DeliveryZone, areas: list<DeliveryArea>}>  $zones
     * @param  list<BranchOpeningHour>  $hours
     * @return array<string, mixed>
     */
    public function branch(
        OrganisationBranch $branch,
        string $kitchenId,
        string $locale,
        array $zones,
        array $hours,
    ): array {
        return [
            'id' => (string) $branch->getKey(),
            'kitchen_id' => $kitchenId,

            // `city`, not `address`: the street address is where a kitchen
            // takes deliveries, and publishing it beside an opening time turns
            // a discovery page into a directory of unstaffed back doors. The
            // area is what a customer needs to know.
            'name' => $branch->name,
            'area' => $branch->city ?? '',
            'country_code' => $branch->country_code,
            'time_zone' => $branch->timezone,
            'delivery_zones' => array_map(
                fn (array $zone): array => $this->zone($zone['zone'], $zone['areas'], $locale),
                $zones,
            ),
            'opening_hours' => array_map($this->openingHours(...), $hours),
            'supports_pickup' => false,
            'is_active' => true,
        ];
    }

    /**
     * One delivery zone, as a customer reads it.
     *
     * The fee and the minimum are the kitchen's own published terms — what it
     * charges to bring food, never what the food costs it — which is why
     * `DeliveryZone` is classified `Internal` rather than `Confidential` and
     * why these two columns are the only monetary values on this whole surface
     * besides the price of a meal.
     *
     * `area` is a single free-form label in the consumer contract while a zone
     * claims a *set* of platform areas, so the set is joined into one label in
     * the locale's own punctuation. The alternative — publishing the first area
     * and dropping the rest — would tell a customer in Deira that a zone
     * covering four places covers Al Quoz.
     *
     * @param  list<DeliveryArea>  $areas
     * @return array<string, mixed>
     */
    public function zone(DeliveryZone $zone, array $areas, string $locale): array
    {
        $names = array_map(
            static fn (DeliveryArea $area): string => $locale === 'ar' ? $area->name_ar : $area->name_en,
            $areas,
        );

        return [
            'id' => (string) $zone->getKey(),
            'name' => MarketplaceLocale::pick($locale, $zone->name_en, $zone->name_ar),
            'area' => MarketplaceLocale::join($locale, $names),
            'country_code' => $areas === [] ? '' : $areas[0]->country_code,
            'delivery_fee' => self::money($zone->delivery_fee_minor, $zone->currency_code),
            'minimum_order' => self::money($zone->minimum_order_minor, $zone->currency_code),
            'estimated_minutes' => $zone->estimated_minutes,
        ];
    }

    /**
     * One configured day.
     *
     * Times are served as `HH:MM` — the shape a human wrote and a picker
     * renders — rather than the `HH:MM:SS` PostgreSQL returns, matching the
     * kitchen-admin projection so the two surfaces cannot disagree about the
     * same row.
     *
     * @return array{weekday: int, opens_at: string|null, closes_at: string|null, order_cut_off_at: string|null}
     */
    public function openingHours(BranchOpeningHour $day): array
    {
        return [
            'weekday' => $day->weekday,
            'opens_at' => self::clock($day->opens_at),
            'closes_at' => self::clock($day->closes_at),
            'order_cut_off_at' => self::clock($day->order_cut_off_at),
        ];
    }

    /**
     * @return array{amount: int, currency: string}|null
     */
    public static function money(?int $amountMinor, string $currencyCode): ?array
    {
        return $amountMinor === null ? null : ['amount' => $amountMinor, 'currency' => $currencyCode];
    }

    private static function clock(?string $time): ?string
    {
        return $time === null ? null : substr($time, 0, 5);
    }
}
