<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Presenters;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Pricing\Services\ResolvedPrice;

/**
 * The public projection of a published meal (master plan v2 §4.8).
 *
 * ## What is deliberately unreachable from here
 *
 * A meal's *recipe* is the confidential half of it. This class is handed the
 * catalogue item, a derived allergen list, a resolved price and a calendar —
 * never a recipe version, never a line, never a quantity, never a cost
 * snapshot, never a supplier. There is no code path from this shape to any of
 * them, which is what "public projection" is supposed to mean.
 *
 * `ResolvedPrice` arrives carrying `price_list_id` and `price_list_item_id`
 * because C1's order snapshot will need them. **Neither reaches the wire.**
 * They are internal identifiers of a confidential table, and a consumer needs
 * the number, not the paperwork behind it.
 *
 * `data_quality_flags`, `review_reason`, `source_system` and `source_ref` are
 * all on the item and all classified `Internal`. None appears below. The
 * quarantine reason in particular is a note about an unresolved food-safety
 * question written for a kitchen, and a quarantined item cannot be published in
 * the first place.
 *
 * ## Nutrition: the one field that says nothing
 *
 * The consumer contract types `nutrition` as a required `NutritionFacts`. **The
 * platform has no authoritative nutrition source and this programme will not
 * fabricate one** — that is what phase N1 exists for, and it is gated on a real
 * source arriving. So the wire schema here deviates from the proposed draft in
 * exactly one place: `nutrition` and `serving` are **nullable**, and both are
 * null on every meal the platform can serve today.
 *
 * Null is the only honest option. Emitting a `NutritionFacts` with plausible
 * numbers would put invented figures in front of somebody choosing food for a
 * medical reason. Emitting one with zeroes would be worse — a zero is a claim.
 * The client turns the null into the contract's required shape with an empty
 * amount list and a provenance line that says so, and the facts panel renders
 * the absence rather than a table of nothing.
 */
final class MarketplaceMealPresenter
{
    /**
     * @param  list<string>  $mealTypes
     * @param  list<string>  $dietClassifications
     * @param  list<string>  $allergens
     * @param  array{b2c: bool, b2b: bool, marketplace: bool, pos: bool, subscription: bool, delivery: bool, pickup: bool, corporate: bool}  $channels
     * @param  list<array{date: string, available: bool, remaining: null, order_cut_off_at: string|null}>  $availability
     * @return array<string, mixed>
     */
    public function meal(
        CatalogueItem $meal,
        string $kitchenName,
        string $locale,
        ResolvedPrice $price,
        array $allergens,
        array $dietClassifications,
        array $mealTypes,
        array $channels,
        array $availability,
    ): array {
        return [
            'id' => (string) $meal->getKey(),
            'kitchen_id' => $meal->organisation_id,
            'kitchen_name' => $kitchenName,
            'item_type' => $meal->item_type->value,
            'name' => MarketplaceLocale::pick($locale, $meal->name_en, $meal->name_ar),
            'slug' => $meal->slug,
            'description' => MarketplaceLocale::pick($locale, $meal->description_en, $meal->description_ar),

            // Empty, and empty for a reason worth stating: nothing on
            // `catalogue_items` records whether a dish is a breakfast or a
            // dinner. A kitchen that sells a lunch box and a breakfast box
            // sells two items, and the difference lives in their names.
            'meal_types' => $mealTypes,
            'diet_classifications' => $dietClassifications,
            'cuisines' => [],
            'allergens' => $allergens,
            'serving' => null,
            'nutrition' => null,
            'price' => ['amount' => $price->amountMinor, 'currency' => $price->currencyCode],

            // No column records how long a dish takes to make, and the
            // production time a kitchen plans with is not the wait a customer
            // experiences anyway.
            'preparation_minutes' => null,
            'image_placeholder_id' => $meal->item_type->value.'-'.$meal->slug,
            'availability' => $availability,
            'channels' => $channels,
            'rating' => null,
            'rating_count' => 0,
        ];
    }
}
